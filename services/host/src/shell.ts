import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IconTarget } from "./icons.js";

export interface ShellApp {
  id: string;
  iconKey: string;
  name: string;
  category: string;
  pinned: boolean;
}

export interface ShellFile {
  id: string;
  name: string;
  location: string;
  kind: string;
  modifiedAt: string;
}

export interface ShellSnapshot {
  capturedAt: number;
  apps: ShellApp[];
}

export interface ShellSearchResults {
  query: string;
  apps: ShellApp[];
  files: ShellFile[];
}

interface RawApp {
  name?: unknown;
  category?: unknown;
  pinned?: unknown;
  shortcutPath?: unknown;
  targetPath?: unknown;
  iconPath?: unknown;
  arguments?: unknown;
  appUserModelId?: unknown;
}

interface RawFile {
  name?: unknown;
  path?: unknown;
  kind?: unknown;
  modifiedAt?: unknown;
}

export class ShellController {
  private apps: ShellApp[] = [];
  private readonly appPaths = new Map<string, string>();
  private readonly appIconPaths = new Map<string, string>();
  private readonly appNames = new Map<string, string>();
  private readonly appProcesses = new Map<string, string>();
  private readonly appUserModelIds = new Map<string, string>();
  private readonly filePaths = new Map<string, string>();
  private refreshRequest: Promise<ShellSnapshot> | null = null;

  async getSnapshot(refresh = false): Promise<ShellSnapshot> {
    if (!refresh && this.apps.length) {
      return { capturedAt: Date.now(), apps: this.apps };
    }
    if (this.refreshRequest) return this.refreshRequest;

    this.refreshRequest = (async () => {
      const script = scriptPath("shell-catalog.ps1");
      const stdout = await runPowerShell(script, [], 12_000);
      const raw = parseArray<RawApp>(stdout);
      const nextApps: ShellApp[] = [];
      const nextPaths = new Map<string, string>();
      const nextIconPaths = new Map<string, string>();
      const nextProcesses = new Map<string, string>();
      const nextAppUserModelIds = new Map<string, string>();

      for (const entry of raw) {
        const name = clean(entry.name, 120);
        const shortcutPath = clean(entry.shortcutPath, 1_024);
        const iconPath = clean(entry.iconPath, 1_024);
        const appUserModelId = clean(entry.appUserModelId, 300);
        if (!name || (!shortcutPath && !isAppUserModelId(appUserModelId))) continue;
        const identityTarget = shortcutPath || `aumid:${appUserModelId}`;
        const id = opaqueId("app", identityTarget);
        if (nextPaths.has(id)) continue;
        if (shortcutPath) nextPaths.set(id, shortcutPath);
        if (iconPath) nextIconPaths.set(id, iconPath);
        if (appUserModelId) nextAppUserModelIds.set(id, appUserModelId);
        const expectedProcess = inferProcessName(
          name,
          clean(entry.targetPath, 1_024),
          clean(entry.arguments, 1_024),
          appUserModelId,
        );
        if (expectedProcess) nextProcesses.set(id, expectedProcess);
        nextApps.push({
          id,
          iconKey: `app:${id}`,
          name,
          category: clean(entry.category, 80) || "Start menu",
          pinned: entry.pinned === true,
        });
      }

      this.apps = nextApps.slice(0, 450);
      this.appPaths.clear();
      this.appIconPaths.clear();
      this.appNames.clear();
      this.appProcesses.clear();
      this.appUserModelIds.clear();
      for (const [id, target] of nextPaths) {
        this.appPaths.set(id, target);
        const iconPath = nextIconPaths.get(id);
        if (iconPath) this.appIconPaths.set(id, iconPath);
        const app = this.apps.find((candidate) => candidate.id === id);
        if (app) this.appNames.set(id, app.name);
        const expectedProcess = nextProcesses.get(id);
        if (expectedProcess) this.appProcesses.set(id, expectedProcess);
      }
      for (const [id, appUserModelId] of nextAppUserModelIds) {
        this.appUserModelIds.set(id, appUserModelId);
        const app = this.apps.find((candidate) => candidate.id === id);
        if (app) this.appNames.set(id, app.name);
        const expectedProcess = nextProcesses.get(id);
        if (expectedProcess) this.appProcesses.set(id, expectedProcess);
      }
      return { capturedAt: Date.now(), apps: this.apps };
    })().finally(() => {
      this.refreshRequest = null;
    });

    return this.refreshRequest;
  }

  async search(value: unknown): Promise<ShellSearchResults> {
    const query = parseSearchQuery(value);
    if (!query) return { query: "", apps: [], files: [] };
    await this.getSnapshot();

    const normalized = query.toLocaleLowerCase();
    const apps = this.apps
      .filter((app) => `${app.name} ${app.category}`.toLocaleLowerCase().includes(normalized))
      .slice(0, 30);

    this.filePaths.clear();
    let files: ShellFile[] = [];
    try {
      const stdout = await runPowerShell(scriptPath("shell-search.ps1"), ["-Query", query], 15_000);
      files = parseArray<RawFile>(stdout).flatMap((entry) => {
        const target = clean(entry.path, 1_024);
        const name = clean(entry.name, 180);
        if (!target || !name) return [];
        const id = opaqueId("file", target);
        this.filePaths.set(id, target);
        return [{
          id,
          name,
          location: friendlyLocation(target),
          kind: clean(entry.kind, 80) || "File",
          modifiedAt: clean(entry.modifiedAt, 80),
        }];
      }).slice(0, 30);
    } catch {
      files = [];
    }

    return { query, apps, files };
  }

  async launch(value: unknown): Promise<boolean> {
    if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value)) return false;
    const target = this.appPaths.get(value) ?? this.filePaths.get(value);
    const appUserModelId = this.appUserModelIds.get(value) ?? "";
    if (!target && !appUserModelId) return false;
    const appName = this.appNames.get(value) ?? "";
    await runPowerShell(
      scriptPath("shell-open.ps1"),
      ["-Path", target ?? "", "-AppName", appName, "-AppUserModelId", appUserModelId],
      8_000,
    );
    return true;
  }

  getIconTarget(key: string): IconTarget | null {
    const match = /^app:([a-f0-9]{24})$/.exec(key);
    if (!match) return null;
    const iconPath = this.appIconPaths.get(match[1]);
    if (iconPath) return { key, path: iconPath };
    const target = this.appPaths.get(match[1]);
    if (target) return { key, path: target };
    const appUserModelId = this.appUserModelIds.get(match[1]);
    return appUserModelId ? { key, appUserModelId } : null;
  }

  getLaunchIdentity(value: unknown): { appName: string; processName: string } | null {
    if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value)) return null;
    const appName = this.appNames.get(value);
    if (!appName) return null;
    return { appName, processName: this.appProcesses.get(value) ?? "" };
  }
}

export function parseSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return query.length >= 2 && query.length <= 80 ? query : null;
}

function scriptPath(name: string): string {
  return fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
}

function runPowerShell(script: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 },
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

function parseArray<T>(value: string): T[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed as T[] : [parsed as T];
}

function opaqueId(kind: "app" | "file", value: string): string {
  return createHash("sha256").update(`${kind}:${value.toLocaleLowerCase()}`).digest("hex").slice(0, 24);
}

function friendlyLocation(target: string): string {
  const parent = path.basename(path.dirname(target));
  return parent || "This PC";
}

function clean(value: unknown, length: number): string {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function inferProcessName(
  appName: string,
  targetPath: string,
  launchArguments: string,
  appUserModelId = "",
): string {
  if (/^file explorer$/i.test(appName)) return "explorer";
  if (/^camera$/i.test(appName)) return "WindowsCamera";
  if (/^settings$/i.test(appName)) return "SystemSettings";
  if (/^notepad$/i.test(appName)) return "Notepad";
  if (/^chatgpt(?: classic)?$/i.test(appName)) return "ChatGPT";
  const processStart = /--processStart(?:AndWait)?\s+(?:"([^"]+\.exe)"|([^\s]+\.exe))/i.exec(launchArguments);
  const executable = processStart?.[1] ?? processStart?.[2] ?? targetPath;
  if (!/\.exe$/i.test(executable)) return "";
  return path.basename(executable, path.extname(executable)).slice(0, 120);
}

function isAppUserModelId(value: string): boolean {
  return /^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$/.test(value);
}
