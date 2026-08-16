import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCameraCommand,
  parseCameraSettings,
} from "./camera.js";

describe("camera PTZ command validation", () => {
  it("accepts bounded movement, home, and preset commands", () => {
    assert.deepEqual(parseCameraCommand({ kind: "move", direction: "Left", amount: 5 }), {
      kind: "move",
      direction: "Left",
      amount: 5,
    });
    assert.deepEqual(parseCameraCommand({ kind: "home" }), { kind: "home" });
    assert.deepEqual(parseCameraCommand({ kind: "presetSave", slot: 2 }), { kind: "presetSave", slot: 2 });
    assert.deepEqual(parseCameraCommand({ kind: "presetRecall", slot: 3 }), { kind: "presetRecall", slot: 3 });
    assert.deepEqual(parseCameraCommand({ kind: "indicatorSet", enabled: false }), {
      kind: "indicatorSet",
      enabled: false,
    });
  });

  it("rejects unknown directions and preset slots", () => {
    assert.equal(parseCameraCommand({ kind: "move", direction: "Around", amount: 5 }), null);
    assert.equal(parseCameraCommand({ kind: "presetSave", slot: 4 }), null);
    assert.equal(parseCameraCommand({ kind: "indicatorSet", enabled: "false" }), null);
    assert.equal(parseCameraCommand({ kind: "set", pan: 10 }), null);
  });

  it("clamps movement magnitude", () => {
    assert.deepEqual(parseCameraCommand({ kind: "move", direction: "Up", amount: 200 }), {
      kind: "move",
      direction: "Up",
      amount: 20,
    });
  });
});

describe("camera indicator settings", () => {
  it("defaults the indicator off when settings are missing or invalid", () => {
    assert.deepEqual(parseCameraSettings(undefined), { indicatorEnabled: false });
    assert.deepEqual(parseCameraSettings({ indicatorEnabled: "yes" }), { indicatorEnabled: false });
  });

  it("restores an explicitly saved indicator choice", () => {
    assert.deepEqual(parseCameraSettings({ indicatorEnabled: true }), { indicatorEnabled: true });
    assert.deepEqual(parseCameraSettings({ indicatorEnabled: false }), { indicatorEnabled: false });
  });
});
