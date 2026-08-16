import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'capture.ps1');
const capture = spawn(
  'powershell.exe',
  [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-Width',
    '640',
    '-Quality',
    '45',
    '-Fps',
    '2',
  ],
  { windowsHide: true },
);

let pending = Buffer.alloc(0);
let finished = false;

capture.stdout.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.length < 4) return;
  const length = pending.readUInt32LE(0);
  if (pending.length < length + 4) return;

  const frame = pending.subarray(4, length + 4);
  const validJpeg =
    frame[0] === 0xff &&
    frame[1] === 0xd8 &&
    frame.at(-2) === 0xff &&
    frame.at(-1) === 0xd9;
  console.log(JSON.stringify({ captureFrameBytes: length, validJpeg }));
  finished = true;
  capture.kill();
  if (!validJpeg) process.exitCode = 1;
});

capture.stderr.on('data', (chunk) => {
  for (const line of chunk.toString('utf8').trim().split(/\r?\n/)) {
    if (line.startsWith('POCKETDESK_META ')) console.log(line);
  }
});

capture.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

setTimeout(() => {
  if (!finished) {
    console.error('Capture smoke test timed out.');
    capture.kill();
    process.exitCode = 1;
  }
}, 10_000).unref();
