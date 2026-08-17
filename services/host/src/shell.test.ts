import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { parseSearchQuery, ShellController } from "./shell.js";

describe("Windows shell search validation", () => {
  it("accepts useful bounded queries", () => {
    assert.equal(parseSearchQuery("  quarterly report  "), "quarterly report");
  });

  it("rejects empty, oversized, and control-only queries", () => {
    assert.equal(parseSearchQuery("a"), null);
    assert.equal(parseSearchQuery("x".repeat(81)), null);
    assert.equal(parseSearchQuery("\r\n"), null);
  });
});

describe("PocketDesk favorites", () => {
  it("adds Aurora FX with its bundled icon", { skip: process.platform !== "win32" }, async () => {
    const previousPath = process.env.POCKETDESK_AURORA_FX_PATH;
    process.env.POCKETDESK_AURORA_FX_PATH = process.execPath;

    try {
      const shell = new ShellController();
      const snapshot = await shell.getSnapshot(true);
      const favorite = snapshot.apps.find((app) => app.name === "Aurora FX");

      assert.ok(favorite);
      assert.equal(favorite.pinned, true);
      assert.equal(favorite.category, "Lighting");
      assert.equal(
        path.basename(shell.getIconTarget(favorite.iconKey)?.path ?? ""),
        "aurora-fx-control.png",
      );
      assert.equal(
        shell.getLaunchIdentity(favorite.id)?.processName,
        path.basename(process.execPath, path.extname(process.execPath)),
      );
    } finally {
      if (previousPath === undefined) delete process.env.POCKETDESK_AURORA_FX_PATH;
      else process.env.POCKETDESK_AURORA_FX_PATH = previousPath;
    }
  });
});
