import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE_ID = /^fs:[a-f0-9]{24}$/;
const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png"]);
const MAX_DIRECTORY_ITEMS = 600;
const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const DOWNLOAD_CHUNK_BYTES = 48 * 1024;

export interface FileLocation {
  id: string;
  name: string;
  pathLabel: string;
  locationKind: "home" | "desktop" | "documents" | "downloads" | "pictures" | "music" | "videos" | "drive";
}

export interface FileEntry {
  id: string;
  name: string;
  kind: "directory" | "file";
  extension: string;
  mimeType: string;
  size: number;
  modifiedAt: number;
  thumbnailAvailable: boolean;
  locationKind?: FileLocation["locationKind"];
}

export interface FileBrowserSnapshot {
  directoryId: string | null;
  name: string;
  pathLabel: string;
  parentId: string | null;
  breadcrumbs: Array<{ id: string | null; name: string }>;
  items: FileEntry[];
  truncated: boolean;
}

export type FileOperation =
  | { kind: "copy" | "move"; sourceIds: string[]; destinationId: string }
  | { kind: "rename"; sourceIds: [string]; name: string }
  | { kind: "delete"; sourceIds: string[] }
  | { kind: "mkdir"; destinationId: string; name: string };

interface RootDefinition {
  name: string;
  target: string;
  kind: FileLocation["locationKind"];
}

export class FileBrowserController {
  private readonly idSecret = randomBytes(24);
  private readonly paths = new Map<string, string>();
  private readonly protectedPaths = new Set<string>();
  private readonly rootOverrides: RootDefinition[] | null;

  constructor(rootOverrides: RootDefinition[] | null = null) {
    this.rootOverrides = rootOverrides;
  }

  async browse(directoryId: string | null): Promise<FileBrowserSnapshot> {
    const roots = await this.getRoots();
    if (directoryId === null) {
      return {
        directoryId: null,
        name: "Browse",
        pathLabel: "This PC",
        parentId: null,
        breadcrumbs: [{ id: null, name: "Browse" }],
        items: roots.map((root) => ({
          id: this.remember(root.target),
          name: root.name,
          kind: "directory",
          extension: "",
          mimeType: "inode/directory",
          size: 0,
          modifiedAt: 0,
          thumbnailAvailable: false,
          locationKind: root.kind,
        })),
        truncated: false,
      };
    }

    const target = this.resolve(directoryId);
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) throw new Error("That folder is no longer available.");

    const rawEntries = await readdir(target, { withFileTypes: true });
    const visibleEntries = rawEntries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .slice(0, MAX_DIRECTORY_ITEMS);
    const items = (await Promise.all(visibleEntries.map(async (entry): Promise<FileEntry | null> => {
      const entryPath = path.join(target, entry.name);
      try {
        const entryStat = await stat(entryPath);
        const extension = entry.isFile() ? path.extname(entry.name).toLocaleLowerCase() : "";
        return {
          id: this.remember(entryPath),
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          extension,
          mimeType: entry.isDirectory() ? "inode/directory" : mimeFor(extension),
          size: entry.isFile() ? entryStat.size : 0,
          modifiedAt: entryStat.mtimeMs,
          thumbnailAvailable: entry.isFile() && IMAGE_EXTENSIONS.has(extension),
        };
      } catch {
        return null;
      }
    }))).filter((entry): entry is FileEntry => entry !== null)
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      });

    const root = longestContainingRoot(target, roots) ?? {
      name: path.parse(target).root.replace(/[\\/]+$/, "") || "Drive",
      target: path.parse(target).root,
      kind: "drive" as const,
    };
    const atRoot = samePath(target, root.target);
    const parentPath = path.dirname(target);
    const breadcrumbs = buildBreadcrumbs(target, root).map((crumb) => ({
      id: this.remember(crumb.target),
      name: crumb.name,
    }));

    return {
      directoryId,
      name: atRoot ? root.name : path.basename(target),
      pathLabel: target,
      parentId: atRoot ? null : this.remember(parentPath),
      breadcrumbs: [{ id: null, name: "Browse" }, ...breadcrumbs],
      items,
      truncated: rawEntries.length > MAX_DIRECTORY_ITEMS,
    };
  }

  async thumbnail(id: string): Promise<{ id: string; dataUri: string } | null> {
    const target = this.resolve(id);
    const extension = path.extname(target).toLocaleLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) return null;
    const details = await stat(target);
    if (!details.isFile() || details.size > 100 * 1024 * 1024) return null;
    const base64 = (await runPowerShell(scriptPath("file-thumbnail.ps1"), ["-Path", target], 12_000)).trim();
    if (!/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length > 120_000) return null;
    return { id, dataUri: `data:image/jpeg;base64,${base64}` };
  }

  async operate(operation: FileOperation): Promise<string> {
    if (operation.kind === "mkdir") {
      const destination = this.resolveDirectory(operation.destinationId);
      const name = validName(operation.name);
      await mkdir(await uniqueDestination(destination, name));
      return "Folder created";
    }

    const sources = operation.sourceIds.map((id) => this.resolve(id));
    if (sources.length === 0 || sources.length > 50) throw new Error("Select between 1 and 50 items.");
    if (sources.some((source) => this.protectedPaths.has(pathKey(source)))) {
      throw new Error("Top-level locations cannot be changed.");
    }

    if (operation.kind === "delete") {
      for (const source of sources) await rm(source, { recursive: true, force: false });
      return sources.length === 1 ? "Item deleted" : `${sources.length} items deleted`;
    }

    if (operation.kind === "rename") {
      const source = sources[0];
      const destination = path.join(path.dirname(source), validName(operation.name));
      await access(destination).then(
        () => { throw new Error("An item with that name already exists."); },
        () => undefined,
      );
      await rename(source, destination);
      this.remember(destination);
      return "Item renamed";
    }

    const destinationDirectory = this.resolveDirectory(operation.destinationId);
    for (const source of sources) {
      if (isSameOrDescendant(destinationDirectory, source)) {
        throw new Error("A folder cannot be copied or moved inside itself.");
      }
      const destination = await uniqueDestination(destinationDirectory, path.basename(source));
      if (operation.kind === "copy") {
        await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
      } else {
        await moveAcrossVolumes(source, destination);
      }
      this.remember(destination);
    }
    return operation.kind === "copy"
      ? sources.length === 1 ? "Item copied" : `${sources.length} items copied`
      : sources.length === 1 ? "Item moved" : `${sources.length} items moved`;
  }

  async open(id: string): Promise<void> {
    const target = this.resolve(id);
    await runPowerShell(scriptPath("file-open.ps1"), ["-Path", target], 10_000);
  }

  async streamDownload(
    id: string,
    requestId: string,
    send: (message: unknown) => Promise<void>,
  ): Promise<void> {
    const target = this.resolve(id);
    const details = await stat(target);
    if (!details.isFile()) throw new Error("Folders cannot be downloaded directly.");
    if (details.size > MAX_DOWNLOAD_BYTES) throw new Error("Downloads are limited to 250 MB per file.");
    const extension = path.extname(target).toLocaleLowerCase();
    await send({
      type: "file-download-start",
      payload: { requestId, name: path.basename(target), size: details.size, mimeType: mimeFor(extension) },
    });
    let sequence = 0;
    for await (const chunk of createReadStream(target, { highWaterMark: DOWNLOAD_CHUNK_BYTES })) {
      await send({
        type: "file-download-chunk",
        payload: { requestId, sequence, data: Buffer.from(chunk).toString("base64") },
      });
      sequence += 1;
    }
    await send({ type: "file-download-end", payload: { requestId, chunks: sequence } });
  }

  isKnownId(value: unknown): value is string {
    return typeof value === "string" && FILE_ID.test(value) && this.paths.has(value);
  }

  private resolve(id: string): string {
    if (!FILE_ID.test(id)) throw new Error("Invalid file reference.");
    const target = this.paths.get(id);
    if (!target) throw new Error("That file reference is no longer available. Refresh the folder.");
    return target;
  }

  private resolveDirectory(id: string): string {
    return this.resolve(id);
  }

  private remember(target: string): string {
    const normalized = path.resolve(target);
    const id = `fs:${createHash("sha256").update(this.idSecret).update(normalized.toLocaleLowerCase()).digest("hex").slice(0, 24)}`;
    this.paths.set(id, normalized);
    return id;
  }

  private async getRoots(): Promise<RootDefinition[]> {
    const candidates = this.rootOverrides ?? defaultRoots();
    const seen = new Set<string>();
    const seenLocationKinds = new Set<FileLocation["locationKind"]>();
    const roots: RootDefinition[] = [];
    for (const candidate of candidates) {
      const normalized = path.resolve(candidate.target);
      const key = normalized.toLocaleLowerCase();
      if (seen.has(key)) continue;
      if (candidate.kind !== "drive" && candidate.kind !== "home" && seenLocationKinds.has(candidate.kind)) continue;
      try {
        if (!(await stat(normalized)).isDirectory()) continue;
      } catch {
        continue;
      }
      seen.add(key);
      seenLocationKinds.add(candidate.kind);
      this.protectedPaths.add(pathKey(normalized));
      roots.push({ ...candidate, target: normalized });
      this.remember(normalized);
    }
    return roots;
  }
}

export function parseFileOperation(value: unknown): FileOperation | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "mkdir") {
    return typeof value.destinationId === "string" && typeof value.name === "string"
      ? { kind: "mkdir", destinationId: value.destinationId, name: value.name }
      : null;
  }
  if (!Array.isArray(value.sourceIds) || !value.sourceIds.every((id) => typeof id === "string")) return null;
  if (value.kind === "delete") return { kind: "delete", sourceIds: value.sourceIds };
  if (value.kind === "rename") {
    return value.sourceIds.length === 1 && typeof value.name === "string"
      ? { kind: "rename", sourceIds: [value.sourceIds[0]], name: value.name }
      : null;
  }
  if ((value.kind === "copy" || value.kind === "move") && typeof value.destinationId === "string") {
    return { kind: value.kind, sourceIds: value.sourceIds, destinationId: value.destinationId };
  }
  return null;
}

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

function defaultRoots(): RootDefinition[] {
  const home = os.homedir();
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || "";
  const homeDrive = path.parse(home).root;
  const workspaceDrive = path.parse(process.cwd()).root;
  return [
    { name: "Home", target: home, kind: "home" },
    ...(oneDrive ? [
      { name: "Desktop", target: path.join(oneDrive, "Desktop"), kind: "desktop" as const },
      { name: "Documents", target: path.join(oneDrive, "Documents"), kind: "documents" as const },
      { name: "Pictures", target: path.join(oneDrive, "Pictures"), kind: "pictures" as const },
    ] : []),
    { name: "Desktop", target: path.join(home, "Desktop"), kind: "desktop" },
    { name: "Documents", target: path.join(home, "Documents"), kind: "documents" },
    { name: "Downloads", target: path.join(home, "Downloads"), kind: "downloads" },
    { name: "Pictures", target: path.join(home, "Pictures"), kind: "pictures" },
    { name: "Music", target: path.join(home, "Music"), kind: "music" },
    { name: "Videos", target: path.join(home, "Videos"), kind: "videos" },
    { name: homeDrive.replace(/[\\/]+$/, "") || "System", target: homeDrive, kind: "drive" },
    { name: workspaceDrive.replace(/[\\/]+$/, "") || "Workspace", target: workspaceDrive, kind: "drive" },
  ];
}

function buildBreadcrumbs(target: string, root: RootDefinition): Array<{ name: string; target: string }> {
  const crumbs = [{ name: root.name, target: root.target }];
  const relative = path.relative(root.target, target);
  if (!relative) return crumbs;
  let current = root.target;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    crumbs.push({ name: segment, target: current });
  }
  return crumbs;
}

function longestContainingRoot(target: string, roots: RootDefinition[]): RootDefinition | null {
  return roots.filter((root) => isSameOrDescendant(target, root.target))
    .sort((left, right) => right.target.length - left.target.length)[0] ?? null;
}

function isSameOrDescendant(target: string, parent: string): boolean {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function pathKey(value: string): string {
  return path.resolve(value).toLocaleLowerCase();
}

function validName(value: string): string {
  const name = value.trim();
  if (!name || name === "." || name === ".." || name.length > 180 || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    throw new Error("Use a valid Windows file or folder name.");
  }
  return name;
}

async function uniqueDestination(directory: string, originalName: string): Promise<string> {
  const extension = path.extname(originalName);
  const base = extension ? originalName.slice(0, -extension.length) : originalName;
  let candidate = path.join(directory, originalName);
  let index = 2;
  while (await exists(candidate)) {
    candidate = path.join(directory, `${base} (${index})${extension}`);
    index += 1;
  }
  return candidate;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function moveAcrossVolumes(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isRecord(error) || error.code !== "EXDEV") throw error;
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    await rm(source, { recursive: true, force: false });
  }
}

function mimeFor(extension: string): string {
  const types: Record<string, string> = {
    ".bmp": "image/bmp", ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac",
    ".pdf": "application/pdf", ".zip": "application/zip", ".7z": "application/x-7z-compressed", ".rar": "application/vnd.rar",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json",
  };
  return types[extension] ?? "application/octet-stream";
}

function scriptPath(name: string): string {
  return fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
}

function runPowerShell(script: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      { windowsHide: true, timeout, maxBuffer: 512_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
