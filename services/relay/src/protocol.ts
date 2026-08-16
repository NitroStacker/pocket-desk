const HOST_MESSAGE_TYPES = new Set([
  "desktop-meta",
  "semantic-snapshot",
  "shell-snapshot",
  "shell-results",
  "shell-launched",
  "app-icon",
  "app-visual",
  "camera-status",
  "host-status",
  "pong",
  "error",
]);

const VIEWER_MESSAGE_TYPES = new Set([
  "input",
  "request-semantic",
  "request-shell",
  "search-shell",
  "launch-shell",
  "request-icons",
  "request-app-visual",
  "request-camera-status",
  "camera-control",
  "set-quality",
  "set-stream",
  "ping",
]);

export function isAllowedRelayMessage(
  role: "host" | "viewer",
  message: string,
): boolean {
  if (message.length > 128_000) return false;

  try {
    const parsed: unknown = JSON.parse(message);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return false;
    return role === "host"
      ? HOST_MESSAGE_TYPES.has(parsed.type)
      : VIEWER_MESSAGE_TYPES.has(parsed.type);
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
