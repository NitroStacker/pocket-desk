import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export interface CameraAxisStatus {
  supported: boolean;
  minimum: number;
  maximum: number;
  step: number;
  defaultValue: number;
  current: number;
  flags: number;
}

export interface CameraIndicatorStatus {
  supported: boolean;
  desired: boolean;
  effective: boolean | null;
  error: string;
}

export interface CameraPtzStatus {
  device: string;
  available: boolean;
  ptz: boolean;
  action: string;
  moved: boolean;
  pan: CameraAxisStatus;
  tilt: CameraAxisStatus;
  zoom: CameraAxisStatus;
  indicator: CameraIndicatorStatus;
  presets: Array<{ slot: 1 | 2 | 3; saved: boolean }>;
  error: string;
}

const PIXY_INDICATOR_UNAVAILABLE =
  "This PIXY firmware controls the green active-camera light internally and does not expose an Off control.";

type CameraDirection = "Left" | "Right" | "Up" | "Down" | "ZoomIn" | "ZoomOut";
type CameraCommand =
  | { kind: "query" }
  | { kind: "move"; direction: CameraDirection; amount: number }
  | { kind: "home" }
  | { kind: "presetSave"; slot: 1 | 2 | 3 }
  | { kind: "presetRecall"; slot: 1 | 2 | 3 }
  | { kind: "indicatorSet"; enabled: boolean };

interface RawCameraReport {
  device?: unknown;
  action?: unknown;
  moved?: unknown;
  pan?: unknown;
  tilt?: unknown;
  zoom?: unknown;
  indicator?: unknown;
  error?: unknown;
}

interface CameraSettings {
  indicatorEnabled: boolean;
}

interface Preset {
  pan: number;
  tilt: number;
  zoom?: number;
}

interface PendingResponse {
  resolve: (value: CameraPtzStatus) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CameraController {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: PendingResponse[] = [];
  private operation: Promise<void> = Promise.resolve();
  private readonly presets = new Map<1 | 2 | 3, Preset>();
  private presetsLoaded = false;
  private settingsLoaded = false;
  private indicatorEnabled = false;
  private readonly presetFile = path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    "PocketDesk",
    "camera-presets.json",
  );
  private readonly settingsFile = path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    "PocketDesk",
    "camera-settings.json",
  );
  private lastStderr = "";

  start(): void {
    // Reserved for camera capabilities that require background reconciliation.
    // PIXY firmware 2.x does not expose control of its active-camera light.
  }

  run(value: unknown): Promise<CameraPtzStatus> {
    const command = parseCameraCommand(value);
    if (!command) return Promise.resolve(this.errorStatus("That camera control command was rejected."));
    const job = this.operation.then(async () => {
      await this.ensurePresetsLoaded();
      await this.ensureSettingsLoaded();
      const status = await this.executeCommand(command);
      return status;
    });
    this.operation = job.then(() => undefined, () => undefined);
    return job.catch((error) => this.errorStatus(
      error instanceof Error ? friendlyControllerError(error.message) : "Camera control was interrupted.",
    ));
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill();
    this.rejectPending(new Error("Camera controller stopped."));
  }

  private async executeCommand(command: CameraCommand): Promise<CameraPtzStatus> {
    if (command.kind === "query") return this.executeRaw({ action: "Query", amount: 1 });
    if (command.kind === "indicatorSet") {
      const status = await this.executeRaw({ action: "Query", amount: 1 });
      return {
        ...status,
        action: "Indicator control unavailable",
      };
    }
    if (command.kind === "move") {
      return this.executeRaw({ action: "Move", direction: command.direction, amount: command.amount });
    }
    if (command.kind === "home") return this.executeRaw({ action: "Home", amount: 1 });
    if (command.kind === "presetSave") {
      const status = await this.executeRaw({ action: "Query", amount: 1 });
      if (!status.ptz) return { ...status, action: "Preset unavailable", error: status.error || "This camera did not expose pan and tilt." };
      this.presets.set(command.slot, {
        pan: status.pan.current,
        tilt: status.tilt.current,
        zoom: status.zoom.supported ? status.zoom.current : undefined,
      });
      await this.persistPresets();
      return this.decorate({ ...status, action: `Saved preset ${command.slot}`, error: "" });
    }
    const preset = this.presets.get(command.slot);
    if (!preset) return this.errorStatus(`Preset ${command.slot} has not been saved yet.`);
    return this.executeRaw({
      action: "Set",
      amount: 1,
      pan: preset.pan,
      tilt: preset.tilt,
      ...(preset.zoom === undefined ? {} : { zoom: preset.zoom }),
    }).then((status) => ({ ...status, action: `Recalled preset ${command.slot}` }));
  }

  private executeRaw(request: Record<string, unknown>): Promise<CameraPtzStatus> {
    const child = this.ensureProcess();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex((entry) => entry.resolve === resolve);
        if (index >= 0) this.pending.splice(index, 1);
        this.stop();
        reject(new Error("The camera did not answer in time."));
      }, 8_000);
      this.pending.push({ resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        const index = this.pending.findIndex((entry) => entry.resolve === resolve);
        if (index >= 0) this.pending.splice(index, 1);
        reject(error);
      });
    });
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const script = fileURLToPath(new URL("../scripts/camera-control.ps1", import.meta.url));
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Server",
        "-DeviceName",
        "EMEET PIXY",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    this.lastStderr = "";
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.lastStderr = `${this.lastStderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.on("error", (error) => {
      if (this.child === child) this.child = null;
      this.rejectPending(error);
    });
    child.on("exit", () => {
      if (this.child === child) this.child = null;
      this.rejectPending(new Error(this.lastStderr.trim() || "The camera controller closed."));
    });
    return child;
  }

  private handleLine(line: string): void {
    const pending = this.pending.shift();
    if (!pending) return;
    clearTimeout(pending.timer);
    try {
      const parsed: unknown = JSON.parse(line);
      pending.resolve(this.decorate(parseReport(parsed)));
    } catch {
      pending.reject(new Error("The camera returned an unreadable response."));
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private decorate(status: CameraPtzStatus): CameraPtzStatus {
    return {
      ...status,
      indicator: {
        supported: false,
        desired: this.indicatorEnabled,
        effective: null,
        error: PIXY_INDICATOR_UNAVAILABLE,
      },
      presets: ([1, 2, 3] as const).map((slot) => ({ slot, saved: this.presets.has(slot) })),
    };
  }

  private async ensurePresetsLoaded(): Promise<void> {
    if (this.presetsLoaded) return;
    this.presetsLoaded = true;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.presetFile, "utf8"));
      if (!isRecord(parsed)) return;
      for (const slot of [1, 2, 3] as const) {
        const value = parsed[String(slot)];
        if (!isRecord(value) || !Number.isSafeInteger(value.pan) || !Number.isSafeInteger(value.tilt)) continue;
        this.presets.set(slot, {
          pan: value.pan as number,
          tilt: value.tilt as number,
          ...(Number.isSafeInteger(value.zoom) ? { zoom: value.zoom as number } : {}),
        });
      }
    } catch {
      // No presets have been saved on this PC yet.
    }
  }

  private async persistPresets(): Promise<void> {
    const serialized: Record<string, Preset> = {};
    for (const [slot, preset] of this.presets) serialized[String(slot)] = preset;
    await mkdir(path.dirname(this.presetFile), { recursive: true });
    await writeFile(this.presetFile, JSON.stringify(serialized, null, 2), "utf8");
  }

  private async ensureSettingsLoaded(): Promise<void> {
    if (this.settingsLoaded) return;
    this.settingsLoaded = true;
    try {
      const settings = parseCameraSettings(JSON.parse(await readFile(this.settingsFile, "utf8")));
      this.indicatorEnabled = settings.indicatorEnabled;
    } catch {
      // Off is deliberately the safe default for a new or unreadable settings file.
      this.indicatorEnabled = false;
    }
  }

  private errorStatus(error: string): CameraPtzStatus {
    const axis = emptyAxis();
    return this.decorate({
      device: "EMEET PIXY",
      available: false,
      ptz: false,
      action: "Error",
      moved: false,
      pan: axis,
      tilt: { ...axis },
      zoom: { ...axis },
      indicator: {
        supported: false,
        desired: this.indicatorEnabled,
        effective: null,
        error: "",
      },
      presets: [],
      error,
    });
  }
}

export function parseCameraCommand(value: unknown): CameraCommand | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "query" || value.kind === "home") return { kind: value.kind };
  if (value.kind === "indicatorSet") {
    return typeof value.enabled === "boolean" ? { kind: value.kind, enabled: value.enabled } : null;
  }
  if (value.kind === "move") {
    const directions: CameraDirection[] = ["Left", "Right", "Up", "Down", "ZoomIn", "ZoomOut"];
    if (!directions.includes(value.direction as CameraDirection)) return null;
    const amount = typeof value.amount === "number" && Number.isSafeInteger(value.amount)
      ? Math.max(1, Math.min(20, value.amount))
      : 5;
    return { kind: "move", direction: value.direction as CameraDirection, amount };
  }
  if (value.kind === "presetSave" || value.kind === "presetRecall") {
    if (value.slot !== 1 && value.slot !== 2 && value.slot !== 3) return null;
    return { kind: value.kind, slot: value.slot };
  }
  return null;
}

function parseReport(value: unknown): CameraPtzStatus {
  if (!isRecord(value)) throw new Error("Camera response was not an object.");
  const raw = value as RawCameraReport;
  const device = clean(raw.device, 120);
  const pan = parseAxis(raw.pan);
  const tilt = parseAxis(raw.tilt);
  const zoom = parseAxis(raw.zoom);
  return {
    device,
    available: !!device,
    ptz: pan.supported && tilt.supported,
    action: clean(raw.action, 80) || "Camera status",
    moved: raw.moved === true,
    pan,
    tilt,
    zoom,
    indicator: parseIndicator(raw.indicator),
    presets: [],
    error: clean(raw.error, 300),
  };
}

function parseIndicator(value: unknown): CameraIndicatorStatus {
  if (!isRecord(value)) {
    return { supported: false, desired: false, effective: null, error: "" };
  }
  const enabled = typeof value.enabled === "boolean" ? value.enabled : null;
  return {
    supported: value.supported === true,
    desired: false,
    effective: value.applied === true ? enabled : null,
    error: clean(value.error, 300),
  };
}

function parseAxis(value: unknown): CameraAxisStatus {
  if (!isRecord(value) || value.supported !== true) return emptyAxis();
  return {
    supported: true,
    minimum: finiteInt(value.minimum),
    maximum: finiteInt(value.maximum),
    step: Math.max(1, finiteInt(value.step)),
    defaultValue: finiteInt(value.defaultValue),
    current: finiteInt(value.current),
    flags: finiteInt(value.flags),
  };
}

function emptyAxis(): CameraAxisStatus {
  return { supported: false, minimum: 0, maximum: 0, step: 0, defaultValue: 0, current: 0, flags: 0 };
}

function finiteInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function clean(value: unknown, length: number): string {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCameraSettings(value: unknown): CameraSettings {
  return {
    indicatorEnabled: isRecord(value) && typeof value.indicatorEnabled === "boolean"
      ? value.indicatorEnabled
      : false,
  };
}

function friendlyControllerError(message: string): string {
  return /not found/i.test(message)
    ? "EMEET PIXY is not connected to Windows."
    : "The camera controller was interrupted. Tap Retry to reconnect it.";
}
