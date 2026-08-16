import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { FileBrowserController, parseFileOperation } from "./files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("native file browser", () => {
  it("navigates opaque directory references and returns file metadata", async () => {
    const root = await createFixture();
    const browser = createBrowser(root);
    const locations = await browser.browse(null);
    assert.equal(locations.items.length, 1);
    assert.equal(locations.items[0].name, "Fixture");
    assert.match(locations.items[0].id, /^fs:[a-f0-9]{24}$/);

    const snapshot = await browser.browse(locations.items[0].id);
    assert.deepEqual(snapshot.items.map((item) => item.name), ["Folder", "notes.txt"]);
    const text = snapshot.items.find((item) => item.name === "notes.txt");
    assert.equal(text?.mimeType, "text/plain");
    assert.equal(text?.size, 5);
  });

  it("copies, moves, renames, creates, and deletes server-discovered items", async () => {
    const root = await createFixture();
    const browser = createBrowser(root);
    const locations = await browser.browse(null);
    let snapshot = await browser.browse(locations.items[0].id);
    const source = required(snapshot.items.find((item) => item.name === "notes.txt")).id;
    const folder = required(snapshot.items.find((item) => item.name === "Folder")).id;

    await browser.operate({ kind: "copy", sourceIds: [source], destinationId: folder });
    let folderSnapshot = await browser.browse(folder);
    assert.equal(await readFile(path.join(root, "Folder", "notes.txt"), "utf8"), "hello");

    const copied = required(folderSnapshot.items.find((item) => item.name === "notes.txt")).id;
    await browser.operate({ kind: "rename", sourceIds: [copied], name: "renamed.txt" });
    folderSnapshot = await browser.browse(folder);
    const renamed = required(folderSnapshot.items.find((item) => item.name === "renamed.txt")).id;
    await browser.operate({ kind: "move", sourceIds: [renamed], destinationId: locations.items[0].id });

    await browser.operate({ kind: "mkdir", destinationId: folder, name: "New Folder" });
    folderSnapshot = await browser.browse(folder);
    assert(folderSnapshot.items.some((item) => item.name === "New Folder"));

    snapshot = await browser.browse(locations.items[0].id);
    const moved = required(snapshot.items.find((item) => item.name === "renamed.txt")).id;
    await browser.operate({ kind: "delete", sourceIds: [moved] });
    snapshot = await browser.browse(locations.items[0].id);
    assert(!snapshot.items.some((item) => item.name === "renamed.txt"));
  });

  it("streams bounded downloads and rejects fabricated references", async () => {
    const root = await createFixture();
    const browser = createBrowser(root);
    const locations = await browser.browse(null);
    const snapshot = await browser.browse(locations.items[0].id);
    const file = required(snapshot.items.find((item) => item.name === "notes.txt"));
    const messages: unknown[] = [];
    await browser.streamDownload(file.id, "12345678-1234-1234-1234-123456789abc", async (message) => {
      messages.push(message);
    });
    assert.equal((messages[0] as { type: string }).type, "file-download-start");
    assert.equal((messages.at(-1) as { type: string }).type, "file-download-end");
    await assert.rejects(() => browser.browse("fs:000000000000000000000000"), /no longer available/);
  });

  it("validates file operation envelopes", () => {
    assert.deepEqual(parseFileOperation({ kind: "delete", sourceIds: ["fs:abc"] }), { kind: "delete", sourceIds: ["fs:abc"] });
    assert.equal(parseFileOperation({ kind: "move", sourceIds: [], destinationId: 4 }), null);
    assert.equal(parseFileOperation({ kind: "rename", sourceIds: ["a", "b"], name: "x" }), null);
  });
});

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pocketdesk-files-"));
  temporaryDirectories.push(root);
  await writeFile(path.join(root, "notes.txt"), "hello");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, "Folder"));
  return root;
}

function createBrowser(root: string): FileBrowserController {
  return new FileBrowserController([{ name: "Fixture", target: root, kind: "home" }]);
}

function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
