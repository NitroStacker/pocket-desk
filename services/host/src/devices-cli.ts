import { loadStoredRelaySession } from "./session-store.js";

interface TrustedDevice {
  id: string;
  name: string;
  createdAt: number;
  lastConnectedAt: number | null;
}

const args = readArgs(process.argv.slice(2));
const relayUrl = (getString(args.relay) ?? process.env.POCKETDESK_RELAY_URL)?.replace(/\/+$/, "");
if (!relayUrl) throw new Error("Pass --relay <https://...> or set POCKETDESK_RELAY_URL.");
const session = await loadStoredRelaySession(relayUrl);
if (!session) throw new Error("No saved PocketDesk host enrollment was found for this relay.");
const activeSession = session;

const command = args._[0] ?? "list";
if (command === "list") {
  const response = await hostRequest(`/api/sessions/${session.sessionId}/devices`);
  const devices = parseDeviceList(response);
  if (!devices.length) {
    console.log("No trusted devices are enrolled.");
  } else {
    console.log("\nTrusted PocketDesk devices\n");
    for (const device of devices) {
      const lastSeen = device.lastConnectedAt
        ? new Date(device.lastConnectedAt).toLocaleString()
        : "Never connected";
      console.log(`${device.name}\n  ID: ${device.id}\n  Last connected: ${lastSeen}\n`);
    }
  }
} else if (command === "add") {
  const name = args._.slice(1).join(" ").trim() || getString(args.name)?.trim();
  if (!name) throw new Error("Name the device, for example: add \"Alex's iPhone\"");
  const response = await hostRequest(
    `/api/sessions/${session.sessionId}/invitations`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
  if (!isRecord(response) || typeof response.pairingCode !== "string" || typeof response.expiresAt !== "number") {
    throw new Error("The relay returned an invalid device invitation.");
  }
  console.log(`\nAdd ${name} to PocketDesk`);
  console.log(`\nPairing code: ${response.pairingCode}`);
  console.log(`Expires: ${new Date(response.expiresAt).toLocaleTimeString()}\n`);
  console.log("Paste this one-time code into PocketDesk on that device.");
} else if (command === "remove") {
  const deviceId = args._[1] ?? getString(args.id);
  if (!deviceId || !/^[a-f0-9-]{36}$/i.test(deviceId)) {
    throw new Error("Pass the device ID shown by the list command.");
  }
  await hostRequest(
    `/api/sessions/${session.sessionId}/devices/${deviceId}`,
    { method: "DELETE" },
  );
  console.log("Trusted device removed. Its active connection has been revoked.");
} else {
  throw new Error("Use list, add <name>, or remove <device-id>.");
}

async function hostRequest(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${activeSession.relayUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${activeSession.hostToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : `Relay returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function parseDeviceList(value: unknown): TrustedDevice[] {
  if (!isRecord(value) || !Array.isArray(value.devices)) {
    throw new Error("The relay returned an invalid trusted-device list.");
  }
  return value.devices.filter((device): device is TrustedDevice =>
    isRecord(device) &&
    typeof device.id === "string" &&
    typeof device.name === "string" &&
    typeof device.createdAt === "number" &&
    (device.lastConnectedAt === null || typeof device.lastConnectedAt === "number"),
  );
}

function readArgs(argv: string[]): { _: string[]; [key: string]: string | string[] | undefined } {
  const result: { _: string[]; [key: string]: string | string[] | undefined } = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
    result[value.slice(2)] = next;
    index += 1;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
