import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface AppVisual {
  processId: number;
  windowHandle: number;
  width: number;
  height: number;
  capturedAt: number;
  dataUri: string;
}

interface RawVisual {
  processId?: unknown;
  windowHandle?: unknown;
  width?: unknown;
  height?: unknown;
  capturedAt?: unknown;
  dataUri?: unknown;
}

export class VisualController {
  private request: Promise<void> = Promise.resolve();

  read(processId: number, windowHandle: number): Promise<AppVisual> {
    const job = this.request.then(async () => {
      const script = fileURLToPath(new URL("../scripts/app-visual.ps1", import.meta.url));
      const stdout = await runPowerShell(script, processId, windowHandle);
      return parseVisual(stdout, processId, windowHandle);
    });
    this.request = job.then(() => undefined, () => undefined);
    return job;
  }
}

function runPowerShell(script: string, processId: number, windowHandle: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-TargetProcessId",
        String(processId),
        "-TargetWindowHandle",
        String(windowHandle),
      ],
      { windowsHide: true, timeout: 12_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function parseVisual(
  value: string,
  expectedProcessId: number,
  expectedWindowHandle: number,
): AppVisual {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("Application preview was malformed.");
  const raw = parsed as RawVisual;
  if (
    raw.processId !== expectedProcessId ||
    raw.windowHandle !== expectedWindowHandle ||
    !finite(raw.width) || raw.width < 1 || raw.width > 1_200 ||
    !finite(raw.height) || raw.height < 1 || raw.height > 2_000 ||
    !finite(raw.capturedAt) ||
    typeof raw.dataUri !== "string" ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(raw.dataUri) ||
    raw.dataUri.length > 110_000
  ) {
    throw new Error("Application preview failed validation.");
  }
  return {
    processId: raw.processId,
    windowHandle: raw.windowHandle,
    width: raw.width,
    height: raw.height,
    capturedAt: raw.capturedAt,
    dataUri: raw.dataUri,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
