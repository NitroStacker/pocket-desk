import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const varsPath = path.resolve(here, '..', '..', 'relay', '.dev.vars');
const vars = await readFile(varsPath, 'utf8');
const adminToken = /^ADMIN_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
if (!adminToken) throw new Error('ADMIN_TOKEN is missing from services/relay/.dev.vars');

const relayUrl = 'http://127.0.0.1:8787';
const response = await fetch(`${relayUrl}/api/sessions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ expiresInHours: 1 }),
});
if (!response.ok) throw new Error(`Session creation failed with HTTP ${response.status}`);
const session = await response.json();
if (
  typeof session.sessionId !== 'string' ||
  typeof session.hostToken !== 'string' ||
  typeof session.viewerToken !== 'string'
) {
  throw new Error('Relay returned malformed session credentials');
}

const socketUrl = `${relayUrl.replace(/^http/, 'ws')}/connect/${session.sessionId}`;
const rejected = new WebSocket(socketUrl, [
  'pocketdesk-v1',
  `viewer.${'0'.repeat(64)}`,
]);
await rejectedWithStatus(rejected, 401);
const host = new WebSocket(socketUrl, ['pocketdesk-v1', `host.${session.hostToken}`]);
await opened(host);
const viewer = new WebSocket(socketUrl, ['pocketdesk-v1', `viewer.${session.viewerToken}`]);
await opened(viewer);

const inputPromise = nextMessage(host, (_data, binary) => !binary);
viewer.send(JSON.stringify({ type: 'input', payload: { kind: 'leftClick' } }));
const input = JSON.parse((await inputPromise).data.toString());
if (input.type !== 'input' || input.payload?.kind !== 'leftClick') {
  throw new Error('Viewer input did not reach the host');
}

const metadataPromise = nextMessage(viewer, (data, binary) => {
  if (binary) return false;
  try {
    return JSON.parse(data.toString()).type === 'desktop-meta';
  } catch {
    return false;
  }
});
host.send(JSON.stringify({ type: 'desktop-meta', payload: { smoke: true } }));
await metadataPromise;

const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const framePromise = nextMessage(viewer, (_data, binary) => binary);
host.send(frame, { binary: true });
const receivedFrame = (await framePromise).data;
if (!Buffer.from(receivedFrame).equals(frame)) {
  throw new Error('Binary frame was modified in transit');
}

host.close(1000, 'smoke complete');
viewer.close(1000, 'smoke complete');
console.log(JSON.stringify({ sessionCreated: true, invalidCredentialsRejected: true, inputRelayed: true, metadataRelayed: true, binaryFrameRelayed: true }));

function opened(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timed out')), 5_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', reject);
  });
}

function rejectedWithStatus(socket, expectedStatus) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Credential rejection timed out')), 5_000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout);
      if (response.statusCode !== expectedStatus) {
        reject(new Error(`Expected HTTP ${expectedStatus}, received ${response.statusCode}`));
        return;
      }
      response.resume();
      resolve();
    });
    socket.once('open', () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error('Invalid WebSocket credentials were accepted'));
    });
    socket.once('error', () => {
      // `unexpected-response` carries the status assertion.
    });
  });
}

function nextMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Expected relay message timed out'));
    }, 5_000);
    const onMessage = (data, binary) => {
      if (!predicate(data, binary)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve({ data, binary });
    };
    socket.on('message', onMessage);
  });
}
