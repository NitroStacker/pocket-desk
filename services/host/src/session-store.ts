import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { RelayCredentials } from "./session.js";

const STORE_VERSION = 1;

interface StoredRelayCredentials extends RelayCredentials {
  version: number;
}

export async function loadStoredRelaySession(
  expectedRelayUrl: string,
): Promise<RelayCredentials | null> {
  if (process.platform !== "win32") return null;
  try {
    const encrypted = await readFile(sessionPath(), "utf8");
    const plain = await runDpapi("decrypt", encrypted.trim());
    const parsed: unknown = JSON.parse(plain);
    if (!isStoredRelayCredentials(parsed)) return null;
    if (normalizeRelayUrl(parsed.relayUrl) !== normalizeRelayUrl(expectedRelayUrl)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return null;
    console.error("[session] Saved host enrollment could not be read; a new pairing may be required.");
    return null;
  }
}

export async function saveRelaySession(credentials: RelayCredentials): Promise<void> {
  if (process.platform !== "win32") return;
  const target = sessionPath();
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true });
  const plain = JSON.stringify({ ...credentials, version: STORE_VERSION });
  const encrypted = await runDpapi("encrypt", plain);
  await writeFile(temporary, encrypted.trim(), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function clearStoredRelaySession(): Promise<void> {
  await rm(sessionPath(), { force: true });
}

function sessionPath(): string {
  const localAppData = process.env.LOCALAPPDATA
    ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "PocketDesk", "host-session.dpapi");
}

function runDpapi(mode: "encrypt" | "decrypt", value: string): Promise<string> {
  const script = mode === "encrypt"
    ? [
        "$plain = [Console]::In.ReadToEnd()",
        "$secure = ConvertTo-SecureString $plain -AsPlainText -Force",
        "try { [Console]::Out.Write((ConvertFrom-SecureString $secure)) } finally { $secure.Dispose() }",
      ].join("; ")
    : [
        "$cipher = [Console]::In.ReadToEnd()",
        "$secure = ConvertTo-SecureString $cipher",
        "$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
        "try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }",
      ].join("; ");

  return new Promise((resolve, reject) => {
    const childEnvironment = { ...process.env };
    delete childEnvironment.PSModulePath;
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: childEnvironment,
      },
    );
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { errorOutput += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && output) resolve(output);
      else reject(new Error(errorOutput.trim() || `Windows credential protection failed (${code}).`));
    });
    child.stdin.end(value);
  });
}

function isStoredRelayCredentials(value: unknown): value is StoredRelayCredentials {
  return isRecord(value) &&
    value.version === STORE_VERSION &&
    typeof value.sessionId === "string" &&
    /^[a-f0-9-]{36}$/i.test(value.sessionId) &&
    typeof value.hostToken === "string" &&
    /^[a-f0-9]{64}$/.test(value.hostToken) &&
    typeof value.pairingCode === "string" &&
    typeof value.pairingExpiresAt === "number" &&
    typeof value.relayUrl === "string" &&
    typeof value.expiresAt === "number" &&
    value.persistent === true;
}

function normalizeRelayUrl(value: string): string {
  return value.replace(/\/+$/, "").toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
