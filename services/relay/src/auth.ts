const encoder = new TextEncoder();

export type SocketRole = "host" | "viewer";

export interface SocketCredentials {
  role: SocketRole;
  token: string;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export async function verifySecret(
  provided: string,
  expected: string,
): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedDigest, expectedDigest);
}

export async function verifyTokenHash(
  provided: string,
  expectedHash: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }

  const providedDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(provided),
  );
  return crypto.subtle.timingSafeEqual(
    providedDigest,
    hexToBytes(expectedHash),
  );
}

export function parseSocketProtocols(
  header: string | null,
): SocketCredentials | null {
  if (!header) return null;

  const protocols = header
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!protocols.includes("pocketdesk-v1")) return null;

  for (const protocol of protocols) {
    const match = /^(host|viewer)\.([a-f0-9]{64})$/.exec(protocol);
    if (match) {
      return { role: match[1] as SocketRole, token: match[2] };
    }
  }

  return null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
