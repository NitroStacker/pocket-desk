import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

type InputCommand =
  | { kind: "pointerDown" | "pointerMove" | "pointerUp" | "tap" | "doubleClick"; x: number; y: number }
  | { kind: "moveRelative"; dx: number; dy: number }
  | { kind: "leftClick" | "rightClick" | "leftDown" | "leftUp" }
  | { kind: "scroll"; delta: number }
  | { kind: "key"; key: string }
  | { kind: "shortcut"; keys: string[] }
  | { kind: "text"; text: string }
  | { kind: "replaceText"; x: number; y: number; text: string }
  | { kind: "focusWindow"; processId: number; windowHandle?: number }
  | { kind: "closeWindow"; processId: number; windowHandle: number };

const ALLOWED_KEYS = new Set([
  "Backspace",
  "Delete",
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "Left",
  "Right",
  "Up",
  "Down",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Ctrl",
  "Alt",
  "Shift",
  "Win",
  "A",
  "C",
  "D",
  "E",
  "F",
  "F4",
  "L",
  "N",
  "P",
  "R",
  "S",
  "T",
  "V",
  "W",
  "X",
  "Z",
]);

export class InputController {
  private process: ChildProcessWithoutNullStreams | null = null;

  start(): void {
    const script = fileURLToPath(new URL("../scripts/input.ps1", import.meta.url));
    this.process = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
      ],
      { windowsHide: true },
    );
    this.process.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) console.error(`[input] ${message}`);
    });
    this.process.on("exit", () => {
      this.process = null;
    });
  }

  send(value: unknown): boolean {
    const command = parseInputCommand(value);
    if (!command || !this.process?.stdin.writable) return false;
    this.process.stdin.write(`${JSON.stringify(command)}\n`);
    return true;
  }

  stop(): void {
    this.process?.kill();
    this.process = null;
  }
}

export function parseInputCommand(value: unknown): InputCommand | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;

  if (["pointerDown", "pointerMove", "pointerUp", "tap", "doubleClick"].includes(value.kind)) {
    if (!isUnit(value.x) || !isUnit(value.y)) return null;
    return { kind: value.kind as InputCommand["kind"], x: value.x, y: value.y } as InputCommand;
  }

  if (value.kind === "moveRelative") {
    if (!isFiniteNumber(value.dx) || !isFiniteNumber(value.dy)) return null;
    return {
      kind: "moveRelative",
      dx: clamp(value.dx, -200, 200),
      dy: clamp(value.dy, -200, 200),
    };
  }

  if (
    value.kind === "leftClick" ||
    value.kind === "rightClick" ||
    value.kind === "leftDown" ||
    value.kind === "leftUp"
  ) {
    return { kind: value.kind };
  }

  if (value.kind === "scroll" && isFiniteNumber(value.delta)) {
    return { kind: "scroll", delta: clamp(value.delta, -1_200, 1_200) };
  }

  if (value.kind === "key" && typeof value.key === "string" && ALLOWED_KEYS.has(value.key)) {
    return { kind: "key", key: value.key };
  }

  if (
    value.kind === "shortcut" &&
    Array.isArray(value.keys) &&
    value.keys.length > 0 &&
    value.keys.length <= 4 &&
    value.keys.every((key) => typeof key === "string" && ALLOWED_KEYS.has(key))
  ) {
    return { kind: "shortcut", keys: value.keys as string[] };
  }

  if (value.kind === "text" && typeof value.text === "string" && value.text.length <= 2_000) {
    return { kind: "text", text: value.text };
  }

  if (
    value.kind === "replaceText" &&
    isUnit(value.x) &&
    isUnit(value.y) &&
    typeof value.text === "string" &&
    value.text.length <= 50_000
  ) {
    return { kind: "replaceText", x: value.x, y: value.y, text: value.text };
  }

  if (
    (value.kind === "focusWindow" || value.kind === "closeWindow") &&
    typeof value.processId === "number" &&
    Number.isSafeInteger(value.processId) &&
    value.processId > 0
  ) {
    if (
      value.windowHandle !== undefined &&
      (typeof value.windowHandle !== "number" ||
        !Number.isSafeInteger(value.windowHandle) ||
        value.windowHandle <= 0)
    ) return null;
    if (value.kind === "closeWindow" && typeof value.windowHandle !== "number") return null;
    return {
      kind: value.kind,
      processId: value.processId,
      ...(typeof value.windowHandle === "number" ? { windowHandle: value.windowHandle } : {}),
    } as InputCommand;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnit(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
