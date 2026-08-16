import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface IconTarget {
  key: string;
  path?: string;
  processId?: number;
  appUserModelId?: string;
}

export interface AppIcon {
  key: string;
  dataUri: string;
}

interface RawIcon {
  key?: unknown;
  dataUri?: unknown;
}

export class IconController {
  private readonly cache = new Map<string, string>();
  private request: Promise<void> = Promise.resolve();

  read(targets: IconTarget[]): Promise<AppIcon[]> {
    const unique = dedupeTargets(targets).slice(0, 120);
    const found = unique.flatMap((target) => {
      const dataUri = this.cache.get(target.key);
      return dataUri ? [{ key: target.key, dataUri }] : [];
    });
    const missing = unique.filter((target) => !this.cache.has(target.key));
    if (!missing.length) return Promise.resolve(found);

    const job = this.request.then(async () => {
      const stillMissing = missing.filter((target) => !this.cache.has(target.key));
      if (!stillMissing.length) return;
      const script = fileURLToPath(new URL("../scripts/icons.ps1", import.meta.url));
      const encoded = Buffer.from(JSON.stringify(stillMissing), "utf8").toString("base64");
      const stdout = await runPowerShell(script, encoded);
      for (const icon of parseIcons(stdout)) {
        this.cache.set(icon.key, icon.dataUri);
      }
      while (this.cache.size > 600) {
        const oldest = this.cache.keys().next().value;
        if (typeof oldest !== "string") break;
        this.cache.delete(oldest);
      }
    });
    this.request = job.catch(() => undefined);
    return job.then(() => unique.flatMap((target) => {
      const dataUri = this.cache.get(target.key);
      return dataUri ? [{ key: target.key, dataUri }] : [];
    }));
  }
}

function runPowerShell(script: string, itemsBase64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-ItemsBase64",
        itemsBase64,
      ],
      { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
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

function parseIcons(value: string): AppIcon[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  const entries: RawIcon[] = Array.isArray(parsed) ? parsed : [parsed as RawIcon];
  return entries.flatMap((entry) => {
    if (
      typeof entry.key !== "string" ||
      !/^(app:[a-f0-9]{24}|window:\d+)$/.test(entry.key) ||
      typeof entry.dataUri !== "string" ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(entry.dataUri) ||
      entry.dataUri.length > 100_000
    ) return [];
    return [{ key: entry.key, dataUri: entry.dataUri }];
  });
}

function dedupeTargets(targets: IconTarget[]): IconTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.key)) return false;
    seen.add(target.key);
    return true;
  });
}
