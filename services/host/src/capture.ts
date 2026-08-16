import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_PROFILES,
  type CaptureProfile,
  type CaptureSettings,
} from "./config.js";

export interface CaptureMeta {
  sourceWidth: number;
  sourceHeight: number;
  streamWidth: number;
  streamHeight: number;
  left: number;
  top: number;
}

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export class CapturePipeline {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pending = Buffer.alloc(0);
  private stopping = false;
  private paused = false;

  constructor(
    private profile: CaptureProfile,
    private readonly onFrame: (frame: Buffer) => void,
    private readonly onMeta: (meta: CaptureMeta, settings: CaptureSettings) => void,
    private readonly onError: (message: string) => void,
  ) {}

  start(): void {
    this.stopping = false;
    if (!this.paused) this.spawnCapture();
  }

  setProfile(profile: CaptureProfile): void {
    if (profile === this.profile) return;
    this.profile = profile;
    if (!this.paused) this.restart();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      const previous = this.process;
      this.process = null;
      previous?.kill();
      this.pending = Buffer.alloc(0);
    } else if (!this.stopping && !this.process) {
      this.spawnCapture();
    }
  }

  stop(): void {
    this.stopping = true;
    this.process?.kill();
    this.process = null;
    this.pending = Buffer.alloc(0);
  }

  private restart(): void {
    const previous = this.process;
    this.process = null;
    previous?.kill();
    this.pending = Buffer.alloc(0);
    this.spawnCapture();
  }

  private spawnCapture(): void {
    const settings = CAPTURE_PROFILES[this.profile];
    const script = fileURLToPath(new URL("../scripts/capture.ps1", import.meta.url));
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Width",
        String(settings.width),
        "-Quality",
        String(settings.quality),
        "-Fps",
        String(settings.fps),
      ],
      { windowsHide: true },
    );
    this.process = child;

    child.stdout.on("data", (chunk: Buffer) => this.readFrames(chunk));

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const lines = stderr.split(/\r?\n/);
      stderr = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("POCKETDESK_META ")) {
          try {
            const meta = JSON.parse(line.slice("POCKETDESK_META ".length)) as CaptureMeta;
            this.onMeta(meta, settings);
          } catch {
            this.onError("Desktop capture returned malformed display metadata.");
          }
        } else if (line.trim()) {
          this.onError(line.trim());
        }
      }
    });

    child.on("error", (error) => {
      if (child === this.process) this.onError(`Capture process error: ${error.message}`);
    });

    child.on("exit", (code) => {
      if (child !== this.process) return;
      this.process = null;
      if (!this.stopping && !this.paused) {
        this.onError(`Desktop capture stopped unexpectedly (exit ${code ?? "unknown"}).`);
      }
    });
  }

  private readFrames(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);

    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32LE(0);
      if (length <= 0 || length > MAX_FRAME_BYTES) {
        this.pending = Buffer.alloc(0);
        this.onError("Desktop capture emitted an invalid frame.");
        return;
      }
      if (this.pending.length < length + 4) return;

      const frame = this.pending.subarray(4, length + 4);
      this.pending = this.pending.subarray(length + 4);
      this.onFrame(frame);
    }
  }
}
