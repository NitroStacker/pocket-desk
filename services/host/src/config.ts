export interface HostConfig {
  relayUrl: string;
  adminToken: string;
  expiresInHours: number;
  initialProfile: CaptureProfile;
}

export type CaptureProfile = "smooth" | "balanced" | "sharp";

export interface CaptureSettings {
  width: number;
  quality: number;
  fps: number;
}

export const CAPTURE_PROFILES: Record<CaptureProfile, CaptureSettings> = {
  smooth: { width: 960, quality: 44, fps: 5 },
  balanced: { width: 1280, quality: 56, fps: 4 },
  sharp: { width: 1600, quality: 68, fps: 3 },
};

export function readConfig(argv: string[], env: NodeJS.ProcessEnv): HostConfig {
  const args = parseArgs(argv);
  const relayUrl = args.relay ?? env.POCKETDESK_RELAY_URL;
  const adminToken = args.admin ?? env.POCKETDESK_ADMIN_TOKEN;
  const expiresRaw = args.expires ?? env.POCKETDESK_EXPIRES_HOURS ?? "12";
  const profileRaw = args.profile ?? env.POCKETDESK_CAPTURE_PROFILE ?? "balanced";

  if (!relayUrl) {
    throw new Error(
      "Missing relay URL. Set POCKETDESK_RELAY_URL or pass --relay <https://...>.",
    );
  }
  if (!adminToken || adminToken.length < 32) {
    throw new Error(
      "Missing or weak admin token. Set POCKETDESK_ADMIN_TOKEN to the Worker secret (32+ characters).",
    );
  }

  const parsedUrl = new URL(relayUrl);
  const isLocal = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
  if (parsedUrl.protocol !== "https:" && !(isLocal && parsedUrl.protocol === "http:")) {
    throw new Error("The relay must use HTTPS (HTTP is accepted only for localhost).");
  }

  const expiresInHours = Number(expiresRaw);
  if (
    !Number.isInteger(expiresInHours) ||
    expiresInHours < 1 ||
    expiresInHours > 24
  ) {
    throw new Error("--expires must be an integer from 1 to 24 hours.");
  }

  if (!isCaptureProfile(profileRaw)) {
    throw new Error("--profile must be smooth, balanced, or sharp.");
  }

  return {
    relayUrl: relayUrl.replace(/\/+$/, ""),
    adminToken,
    expiresInHours,
    initialProfile: profileRaw,
  };
}

export function isCaptureProfile(value: string): value is CaptureProfile {
  return value === "smooth" || value === "balanced" || value === "sharp";
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const name = current.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}.`);
    }
    result[name] = value;
    index += 1;
  }
  return result;
}
