import os from "node:os";
import WebSocket from "ws";
import { CameraController } from "./camera.js";
import { CapturePipeline, type CaptureMeta } from "./capture.js";
import {
  isCaptureProfile,
  readConfig,
  type CaptureProfile,
  type CaptureSettings,
} from "./config.js";
import { InputController } from "./input.js";
import { IconController, type IconTarget } from "./icons.js";
import { captureSemanticSnapshot, type SemanticSnapshot, type SemanticWindow } from "./semantic.js";
import { createRelaySession } from "./session.js";
import { ShellController } from "./shell.js";
import { VisualController } from "./visual.js";

if (process.platform !== "win32") {
  console.error("PocketDesk Host currently supports Windows only.");
  process.exit(1);
}

const config = readConfig(process.argv.slice(2), process.env);
const session = await createRelaySession(
  config.relayUrl,
  config.adminToken,
  config.expiresInHours,
);

console.log("\nPocketDesk Host is ready to pair");
console.log(`Relay: ${session.relayUrl}`);
console.log(`Pairing code: ${session.pairingCode}`);
console.log(`Expires: ${new Date(session.expiresAt).toLocaleString()}`);
console.log("\nOpen the Expo Go app, enter the relay and pairing code, then connect.\n");

let socket: WebSocket | null = null;
let viewerCount = 0;
let reconnectAttempt = 0;
let shuttingDown = false;
let desktopMeta: (CaptureMeta & CaptureSettings & { machineName: string; profile: CaptureProfile }) | null = null;
let semanticRequest: Promise<void> | null = null;
let semanticRescanRequested = false;
let semanticRefreshTimer: NodeJS.Timeout | null = null;
let streamEnabled = false;
let semanticWindowsByHandle = new Map<number, SemanticWindow>();
let semanticTargetProcessId = 0;
let semanticTargetWindowHandle = 0;
let semanticTargetRevision = 0;
let consecutiveSemanticFailures = 0;
let pendingLaunch: {
  windowHandles: Set<number>;
  appName: string;
  processName: string;
  attempts: number;
} | null = null;

const input = new InputController();
input.start();
const shell = new ShellController();
const icons = new IconController();
const visuals = new VisualController();
const camera = new CameraController();
void shell.getSnapshot().catch((error) => {
  console.error(`[shell] ${error instanceof Error ? error.message : "Could not read the Windows app catalog."}`);
});

const capture = new CapturePipeline(
  config.initialProfile,
  (frame) => {
    if (
      socket?.readyState === WebSocket.OPEN &&
      viewerCount > 0 &&
      socket.bufferedAmount < 1_500_000
    ) {
      socket.send(frame, { binary: true, compress: false });
    }
  },
  (meta, settings) => {
    desktopMeta = {
      ...meta,
      ...settings,
      machineName: os.hostname(),
      profile: currentProfile,
    };
    sendJson({ type: "desktop-meta", payload: desktopMeta });
  },
  (message) => console.error(`[capture] ${message}`),
);

let currentProfile = config.initialProfile;
capture.setPaused(true);
capture.start();
connect();

function connect(): void {
  if (shuttingDown) return;

  const socketUrl = `${session.relayUrl.replace(/^http/, "ws")}/connect/${session.sessionId}`;
  const next = new WebSocket(socketUrl, [
    "pocketdesk-v1",
    `host.${session.hostToken}`,
  ], {
    perMessageDeflate: false,
    handshakeTimeout: 15_000,
  });
  socket = next;

  next.on("open", () => {
    reconnectAttempt = 0;
    console.log("Connected securely to the Cloudflare relay.");
    if (desktopMeta) sendJson({ type: "desktop-meta", payload: desktopMeta });
    sendJson({ type: "host-status", online: true });
  });

  next.on("message", (data, isBinary) => {
    if (isBinary) return;
    handleRelayMessage(data.toString());
  });

  next.on("error", (error) => {
    console.error(`[relay] ${error.message}`);
  });

  next.on("close", (code, reason) => {
    viewerCount = 0;
    if (shuttingDown) return;
    const delay = Math.min(10_000, 1_000 * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    console.error(
      `[relay] disconnected (${code}${reason.length ? `: ${reason.toString()}` : ""}); retrying in ${Math.round(delay / 1000)}s`,
    );
    setTimeout(connect, delay);
  });
}

function handleRelayMessage(raw: string): void {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isRecord(message) || typeof message.type !== "string") return;

  if (message.type === "relay-status") {
    const previous = viewerCount;
    viewerCount = typeof message.viewerCount === "number" ? message.viewerCount : 0;
    if (viewerCount !== previous) {
      console.log(`${viewerCount} mobile viewer${viewerCount === 1 ? "" : "s"} connected.`);
      if (viewerCount > 0) {
        void sendSemanticSnapshot();
        void sendShellSnapshot();
      }
      if (viewerCount === 0) {
        streamEnabled = false;
        capture.setPaused(true);
      }
    }
    return;
  }

  if (message.type === "input") {
    if (
      isRecord(message.payload) &&
      message.payload.kind === "focusWindow" &&
      typeof message.payload.processId === "number" &&
      Number.isSafeInteger(message.payload.processId) &&
      message.payload.processId > 0
    ) {
      const requestedProcessId = message.payload.processId;
      const requestedHandle = typeof message.payload.windowHandle === "number" &&
        Number.isSafeInteger(message.payload.windowHandle) && message.payload.windowHandle > 0
        ? message.payload.windowHandle
        : 0;
      const selected = requestedHandle > 0
        ? semanticWindowsByHandle.get(requestedHandle)
        : [...semanticWindowsByHandle.values()].find(
          (window) => window.processId === requestedProcessId,
        );
      if (!selected || selected.processId !== requestedProcessId) {
        sendJson({ type: "error", code: "WINDOW_NOT_FOUND", message: "That application window is no longer open." });
        void sendSemanticSnapshot();
        return;
      }
      setSemanticTarget(selected.processId, selected.windowHandle);
      input.send({
        kind: "focusWindow",
        processId: selected.processId,
        windowHandle: selected.windowHandle,
      });
      scheduleSemanticRefresh();
      return;
    }
    if (
      semanticTargetProcessId > 0 &&
      isRecord(message.payload) &&
      message.payload.kind !== "focusWindow"
    ) {
      input.send({
        kind: "focusWindow",
        processId: semanticTargetProcessId,
        windowHandle: semanticTargetWindowHandle,
      });
    }
    if (input.send(message.payload) && shouldRefreshAfterInput(message.payload)) {
      scheduleSemanticRefresh();
    }
    return;
  }

  if (message.type === "request-semantic") {
    void sendSemanticSnapshot();
    return;
  }

  if (message.type === "request-shell") {
    void sendShellSnapshot(message.payload === undefined ? false : isRefreshRequest(message.payload));
    return;
  }

  if (message.type === "search-shell" && isRecord(message.payload)) {
    void sendShellSearch(message.payload.query);
    return;
  }

  if (message.type === "launch-shell" && isRecord(message.payload)) {
    void launchShellItem(message.payload.id);
    return;
  }

  if (message.type === "request-icons" && isRecord(message.payload)) {
    void sendRequestedIcons(message.payload.keys);
    return;
  }

  if (message.type === "request-app-visual" && isRecord(message.payload)) {
    void sendAppVisual(message.payload.processId, message.payload.windowHandle);
    return;
  }

  if (message.type === "request-camera-status") {
    void sendCameraStatus({ kind: "query" });
    return;
  }

  if (message.type === "camera-control") {
    void sendCameraStatus(message.payload);
    return;
  }

  if (message.type === "set-quality" && isRecord(message.payload)) {
    const profile = message.payload.profile;
    if (typeof profile === "string" && isCaptureProfile(profile)) {
      currentProfile = profile;
      capture.setProfile(profile);
    }
    return;
  }

  if (message.type === "set-stream" && isRecord(message.payload)) {
    streamEnabled = message.payload.enabled === true && viewerCount > 0;
    capture.setPaused(!streamEnabled);
    return;
  }

  if (message.type === "ping" && typeof message.timestamp === "number") {
    sendJson({ type: "pong", timestamp: message.timestamp });
  }
}

function shouldRefreshAfterInput(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  return !["pointerDown", "pointerMove", "moveRelative"].includes(value.kind);
}

function scheduleSemanticRefresh(): void {
  if (semanticRefreshTimer) clearTimeout(semanticRefreshTimer);
  semanticRefreshTimer = setTimeout(() => {
    semanticRefreshTimer = null;
    void sendSemanticSnapshot();
  }, 450);
}

async function sendSemanticSnapshot(): Promise<void> {
  if (semanticRequest) {
    semanticRescanRequested = true;
    return semanticRequest;
  }
  semanticRequest = (async () => {
    try {
      let scanRevision = semanticTargetRevision;
      let snapshot = await captureSemanticSnapshot(
        semanticTargetProcessId,
        semanticTargetWindowHandle,
      );
      if (scanRevision !== semanticTargetRevision) {
        semanticRescanRequested = true;
        return;
      }
      if (pendingLaunch && semanticTargetWindowHandle <= 0) {
        const launchedWindow = pickLaunchedWindow(snapshot.windows, pendingLaunch);
        if (!launchedWindow && pendingLaunch.attempts < 3) {
          pendingLaunch.attempts += 1;
          setTimeout(() => void sendSemanticSnapshot(), 700);
          return;
        }
        pendingLaunch = null;
        if (launchedWindow && launchedWindow.windowHandle !== snapshot.activeWindowHandle) {
          setSemanticTarget(launchedWindow.processId, launchedWindow.windowHandle);
          input.send({
            kind: "focusWindow",
            processId: launchedWindow.processId,
            windowHandle: launchedWindow.windowHandle,
          });
          scanRevision = semanticTargetRevision;
          snapshot = await captureSemanticSnapshot(
            launchedWindow.processId,
            launchedWindow.windowHandle,
          );
          if (scanRevision !== semanticTargetRevision) {
            semanticRescanRequested = true;
            return;
          }
        } else if (launchedWindow) {
          setSemanticTarget(launchedWindow.processId, launchedWindow.windowHandle);
        }
      }
      const requestedWindowStillExists = snapshot.windows.some(
        (window) => window.processId === semanticTargetProcessId &&
          (semanticTargetWindowHandle <= 0 || window.windowHandle === semanticTargetWindowHandle),
      );
      if (semanticTargetProcessId <= 0 || !requestedWindowStillExists) {
        if (snapshot.activeProcessId > 0 && snapshot.activeWindowHandle > 0) {
          setSemanticTarget(snapshot.activeProcessId, snapshot.activeWindowHandle);
        } else {
          setSemanticTarget(0, 0);
        }
      }
      consecutiveSemanticFailures = 0;
      publishSemanticSnapshot(snapshot);
    } catch (error) {
      consecutiveSemanticFailures += 1;
      console.error(`[semantic] ${internalError(error)}`);
      if (semanticWindowsByHandle.size > 0 && consecutiveSemanticFailures <= 3) {
        setTimeout(() => void sendSemanticSnapshot(), 500 * consecutiveSemanticFailures);
      } else {
        sendJson({
          type: "error",
          code: "SEMANTIC_SCAN_FAILED",
          message: "The selected app could not be read yet. Keep it open and tap Sync to try again.",
        });
      }
    } finally {
      semanticRequest = null;
      if (semanticRescanRequested) {
        semanticRescanRequested = false;
        setTimeout(() => void sendSemanticSnapshot(), 0);
      }
    }
  })();
  return semanticRequest;
}

async function sendRequestedIcons(value: unknown): Promise<void> {
  const keys = parseIconKeys(value);
  if (!keys.length) return;
  const targets: IconTarget[] = [];
  for (const key of keys) {
    const app = shell.getIconTarget(key);
    if (app) {
      targets.push(app);
      continue;
    }
    const match = /^window:(\d+)$/.exec(key);
    if (!match) continue;
    const processId = Number(match[1]);
    if ([...semanticWindowsByHandle.values()].some((window) => window.processId === processId)) {
      targets.push({ key, processId });
    }
  }

  try {
    const results = await icons.read(targets);
    for (const icon of results) sendJson({ type: "app-icon", payload: icon });
  } catch (error) {
    console.error(`[icons] ${error instanceof Error ? error.message : "Icon extraction failed."}`);
  }
}

async function sendAppVisual(value: unknown, handleValue: unknown): Promise<void> {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) return;
  const requestedHandle = typeof handleValue === "number" &&
    Number.isSafeInteger(handleValue) && handleValue > 0 ? handleValue : 0;
  const selected = requestedHandle > 0
    ? semanticWindowsByHandle.get(requestedHandle)
    : [...semanticWindowsByHandle.values()].find(
      (window) => window.processId === value &&
        (semanticTargetWindowHandle <= 0 || window.windowHandle === semanticTargetWindowHandle),
    );
  if (selected?.processId !== value) return;
  if (!selected) return;
  try {
    const visual = await visuals.read(selected.processId, selected.windowHandle);
    sendJson({ type: "app-visual", payload: visual });
  } catch (error) {
    console.error(`[visual] ${error instanceof Error ? error.message : "Application preview failed."}`);
  }
}

async function sendCameraStatus(command: unknown): Promise<void> {
  const status = await camera.run(command);
  sendJson({ type: "camera-status", payload: status });
}

async function sendShellSnapshot(refresh = false): Promise<void> {
  try {
    const snapshot = await shell.getSnapshot(refresh);
    sendJson({ type: "shell-snapshot", payload: snapshot });
  } catch (error) {
    console.error(`[shell] ${internalError(error)}`);
    sendJson({
      type: "error",
      code: "SHELL_CATALOG_FAILED",
      message: "The Windows app library could not be refreshed. Please try Sync again.",
    });
  }
}

async function sendShellSearch(query: unknown): Promise<void> {
  try {
    const results = await shell.search(query);
    sendJson({ type: "shell-results", payload: results });
  } catch (error) {
    console.error(`[search] ${internalError(error)}`);
    sendJson({
      type: "error",
      code: "SHELL_SEARCH_FAILED",
      message: "Windows search was interrupted. Please try that search again.",
    });
  }
}

async function launchShellItem(id: unknown): Promise<void> {
  const previousProcessId = semanticTargetProcessId;
  const previousWindowHandle = semanticTargetWindowHandle;
  try {
    const windowsBeforeLaunch = new Set(semanticWindowsByHandle.keys());
    const identity = shell.getLaunchIdentity(id);
    setSemanticTarget(0, 0);
    pendingLaunch = {
      windowHandles: windowsBeforeLaunch,
      appName: identity?.appName ?? "",
      processName: identity?.processName ?? "",
      attempts: 0,
    };
    const launched = await shell.launch(id);
    if (!launched) {
      pendingLaunch = null;
      setSemanticTarget(previousProcessId, previousWindowHandle);
      sendJson({ type: "error", code: "SHELL_ITEM_REJECTED", message: "That app or file is no longer available." });
      return;
    }
    sendJson({ type: "shell-launched", payload: { id } });
    setTimeout(() => void sendSemanticSnapshot(), 900);
  } catch (error) {
    pendingLaunch = null;
    setSemanticTarget(previousProcessId, previousWindowHandle);
    console.error(`[launch] ${internalError(error)}`);
    sendJson({
      type: "error",
      code: "SHELL_LAUNCH_FAILED",
      message: "Windows could not open that app or file. It may have moved or be unavailable.",
    });
  }
}

function publishSemanticSnapshot(snapshot: SemanticSnapshot): void {
  semanticWindowsByHandle = new Map(
    snapshot.windows.map((window) => [window.windowHandle, window]),
  );
  sendJson({ type: "semantic-snapshot", payload: snapshot });
}

function setSemanticTarget(processId: number, windowHandle: number): void {
  if (
    semanticTargetProcessId === processId &&
    semanticTargetWindowHandle === windowHandle
  ) return;
  semanticTargetProcessId = processId;
  semanticTargetWindowHandle = windowHandle;
  semanticTargetRevision += 1;
}

function pickLaunchedWindow(
  windows: SemanticWindow[],
  launch: NonNullable<typeof pendingLaunch>,
): SemanticWindow | null {
  const expectedProcess = normalizeIdentity(launch.processName);
  const expectedApp = normalizeIdentity(launch.appName);
  const ranked = windows.map((window) => {
    const process = normalizeIdentity(window.process);
    const title = normalizeIdentity(window.title);
    const isNew = !launch.windowHandles.has(window.windowHandle);
    const processMatch = !!expectedProcess && process === expectedProcess;
    const appMatch = !!expectedApp && (
      process === expectedApp || title === expectedApp || title.startsWith(expectedApp)
    );
    const popup = /^(popuphost|applicationframewindow)$/i.test(window.title);
    let score = 0;
    if (processMatch) score += 120;
    if (appMatch) score += 100;
    if (isNew) score += 60;
    if (window.active) score += 20;
    if (popup) score -= 140;
    return { window, score, strong: (processMatch || appMatch || isNew) && !popup };
  }).sort((a, b) => b.score - a.score);
  const strong = ranked.find((candidate) => candidate.strong);
  if (strong) return strong.window;
  if (!expectedProcess && !expectedApp) return ranked.find((candidate) => candidate.window.active)?.window ?? null;
  return launch.attempts >= 3
    ? ranked.find((candidate) => candidate.window.active)?.window ?? null
    : null;
}

function normalizeIdentity(value: string): string {
  return value.toLocaleLowerCase().replace(/\.exe$/i, "").replace(/[^a-z0-9]+/g, "");
}

function internalError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` Cause: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

function sendJson(value: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIconKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (key): key is string => typeof key === "string" && /^(app:[a-f0-9]{24}|window:\d{1,10})$/.test(key),
  ))].slice(0, 120);
}

function isRefreshRequest(value: unknown): boolean {
  return isRecord(value) && value.refresh === true;
}

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping PocketDesk Host…");
  capture.stop();
  input.stop();
  camera.stop();
  if (semanticRefreshTimer) clearTimeout(semanticRefreshTimer);
  socket?.close(1000, "Host stopped");
  setTimeout(() => process.exit(0), 250);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
