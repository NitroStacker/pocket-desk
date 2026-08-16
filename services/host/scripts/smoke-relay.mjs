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
  typeof session.pairingCode !== 'string'
) {
  throw new Error('Relay returned malformed session credentials');
}

const pairingToken = session.pairingCode.slice(session.pairingCode.indexOf('.') + 1);
const enrollmentResponse = await fetch(`${relayUrl}/api/sessions/${session.sessionId}/enroll`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pairingToken }),
});
if (!enrollmentResponse.ok) throw new Error(`Device enrollment failed with HTTP ${enrollmentResponse.status}`);
const enrollment = await enrollmentResponse.json();
if (typeof enrollment.viewerToken !== 'string' || typeof enrollment.deviceId !== 'string') {
  throw new Error('Relay returned malformed device enrollment');
}
const replayResponse = await fetch(`${relayUrl}/api/sessions/${session.sessionId}/enroll`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pairingToken }),
});
if (replayResponse.status !== 409) throw new Error('A one-use pairing code was accepted twice');

const deviceListResponse = await fetch(`${relayUrl}/api/sessions/${session.sessionId}/devices`, {
  headers: { Authorization: `Bearer ${session.hostToken}` },
});
if (!deviceListResponse.ok) throw new Error(`Device listing failed with HTTP ${deviceListResponse.status}`);
const deviceList = await deviceListResponse.json();
if (!deviceList.devices?.some((device) => device.id === enrollment.deviceId)) {
  throw new Error('Enrolled device was missing from the PC trusted-device list');
}

const socketUrl = `${relayUrl.replace(/^http/, 'ws')}/connect/${session.sessionId}`;
const rejected = new WebSocket(socketUrl, [
  'pocketdesk-v1',
  `viewer.${'0'.repeat(64)}`,
]);
await rejectedWithStatus(rejected, 401);
const host = new WebSocket(socketUrl, ['pocketdesk-v1', `host.${session.hostToken}`]);
await opened(host);
const viewer = new WebSocket(socketUrl, ['pocketdesk-v1', `viewer.${enrollment.viewerToken}`]);
await opened(viewer);

const inputPromise = nextMessage(host, (data, binary) => {
  if (binary) return false;
  try { return JSON.parse(data.toString()).type === 'input'; } catch { return false; }
});
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

const secure = new WebSocket(socketUrl, ['pocketdesk-v1', `secure.${session.hostToken}`]);
await opened(secure);
const viewerSecurePromise = nextMessage(viewer, (data, binary) => {
  if (binary) return false;
  try {
    const message = JSON.parse(data.toString());
    return message.type === 'secure-status' && message.active === true;
  } catch {
    return false;
  }
});
const hostSecurePromise = nextMessage(host, (data, binary) => {
  if (binary) return false;
  try {
    const message = JSON.parse(data.toString());
    return message.type === 'secure-status' && message.active === true;
  } catch {
    return false;
  }
});
secure.send(JSON.stringify({ type: 'secure-status', active: true, desktopName: 'Winlogon' }));
await Promise.all([viewerSecurePromise, hostSecurePromise]);

const secureInputPromise = nextMessage(secure, (data, binary) => {
  if (binary) return false;
  try { return JSON.parse(data.toString()).type === 'input'; } catch { return false; }
});
const normalInputSuppressed = expectNoMessage(host, (data, binary) => {
  if (binary) return false;
  try { return JSON.parse(data.toString()).type === 'input'; } catch { return false; }
}, 350);
viewer.send(JSON.stringify({ type: 'input', payload: { kind: 'tap', x: 0.5, y: 0.5 } }));
const secureInput = JSON.parse((await secureInputPromise).data.toString());
if (secureInput.payload?.kind !== 'tap') throw new Error('Secure input routing returned the wrong command');
await normalInputSuppressed;

const secureMetadataPromise = nextMessage(viewer, (data, binary) => {
  if (binary) return false;
  try { return JSON.parse(data.toString()).payload?.secureSmoke === true; } catch { return false; }
});
const normalMetadataSuppressed = expectNoMessage(viewer, (data, binary) => {
  if (binary) return false;
  try { return JSON.parse(data.toString()).payload?.normalShouldBeSuppressed === true; } catch { return false; }
}, 350);
host.send(JSON.stringify({ type: 'desktop-meta', payload: { normalShouldBeSuppressed: true } }));
secure.send(JSON.stringify({ type: 'desktop-meta', payload: { secureSmoke: true } }));
await Promise.all([secureMetadataPromise, normalMetadataSuppressed]);

const viewerUnlockedPromise = nextMessage(viewer, (data, binary) => {
  if (binary) return false;
  try {
    const message = JSON.parse(data.toString());
    return message.type === 'secure-status' && message.active === false;
  } catch {
    return false;
  }
});
secure.send(JSON.stringify({ type: 'secure-status', active: false, desktopName: 'Default' }));
await viewerUnlockedPromise;

const handedBackInputPromise = nextMessage(host, (data, binary) => {
  if (binary) return false;
  try { return JSON.parse(data.toString()).payload?.kind === 'rightClick'; } catch { return false; }
});
viewer.send(JSON.stringify({ type: 'input', payload: { kind: 'rightClick' } }));
await handedBackInputPromise;
secure.close(1000, 'secure smoke complete');

const revokedPromise = closedWithCode(viewer, 4003);
const revokeResponse = await fetch(`${relayUrl}/api/sessions/${session.sessionId}/devices/${enrollment.deviceId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${session.hostToken}` },
});
if (!revokeResponse.ok) throw new Error(`Device revocation failed with HTTP ${revokeResponse.status}`);
await revokedPromise;
host.close(1000, 'smoke complete');
console.log(JSON.stringify({ sessionCreated: true, oneUseEnrollment: true, deviceListed: true, deviceRevoked: true, invalidCredentialsRejected: true, inputRelayed: true, metadataRelayed: true, binaryFrameRelayed: true, secureHostAuthenticated: true, secureInputExclusive: true, secureMetadataExclusive: true, normalHostHandoff: true }));

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

function closedWithCode(socket, expectedCode) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Expected socket revocation timed out')), 5_000);
    socket.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== expectedCode) {
        reject(new Error(`Expected close ${expectedCode}, received ${code}`));
        return;
      }
      resolve();
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

function expectNoMessage(socket, predicate, duration) {
  return new Promise((resolve, reject) => {
    const onMessage = (data, binary) => {
      if (!predicate(data, binary)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      reject(new Error('A relay message reached a socket that should have been isolated'));
    };
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, duration);
    socket.on('message', onMessage);
  });
}
