import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInputCommand } from "./input.js";

describe("desktop input validation", () => {
  it("accepts bounded pointer and keyboard commands", () => {
    assert.deepEqual(parseInputCommand({ kind: "tap", x: 0.25, y: 0.75 }), {
      kind: "tap",
      x: 0.25,
      y: 0.75,
    });
    assert.deepEqual(
      parseInputCommand({ kind: "shortcut", keys: ["Ctrl", "L"] }),
      { kind: "shortcut", keys: ["Ctrl", "L"] },
    );
    assert.deepEqual(
      parseInputCommand({ kind: "focusWindow", processId: 2840, windowHandle: 133502 }),
      { kind: "focusWindow", processId: 2840, windowHandle: 133502 },
    );
    assert.deepEqual(
      parseInputCommand({ kind: "closeWindow", processId: 2840, windowHandle: 133502 }),
      { kind: "closeWindow", processId: 2840, windowHandle: 133502 },
    );
    assert.deepEqual(parseInputCommand({ kind: "leftDown" }), { kind: "leftDown" });
    assert.deepEqual(parseInputCommand({ kind: "leftUp" }), { kind: "leftUp" });
  });

  it("rejects out-of-bounds or unknown commands", () => {
    assert.equal(parseInputCommand({ kind: "tap", x: -1, y: 0.5 }), null);
    assert.equal(parseInputCommand({ kind: "shell", command: "whoami" }), null);
    assert.equal(parseInputCommand({ kind: "focusWindow", processId: 2840, windowHandle: -1 }), null);
    assert.equal(parseInputCommand({ kind: "closeWindow", processId: 2840 }), null);
    assert.equal(parseInputCommand({ kind: "closeWindow", processId: 2840, windowHandle: -1 }), null);
    assert.equal(
      parseInputCommand({ kind: "shortcut", keys: ["Ctrl", "Unknown"] }),
      null,
    );
  });

  it("caps relative movement and text size", () => {
    assert.deepEqual(
      parseInputCommand({ kind: "moveRelative", dx: 9_999, dy: -9_999 }),
      { kind: "moveRelative", dx: 200, dy: -200 },
    );
    assert.equal(parseInputCommand({ kind: "text", text: "x".repeat(2_001) }), null);
    assert.deepEqual(
      parseInputCommand({ kind: "replaceText", x: 0.4, y: 0.6, text: "updated" }),
      { kind: "replaceText", x: 0.4, y: 0.6, text: "updated" },
    );
    assert.equal(
      parseInputCommand({ kind: "replaceText", x: 0.4, y: 0.6, text: "x".repeat(50_001) }),
      null,
    );
  });

  it("accepts only bounded Aurora FX controls", () => {
    assert.deepEqual(
      parseInputCommand({ kind: "aurora", action: "setColor", color: "#51e5ff" }),
      { kind: "aurora", action: "setColor", color: "#51E5FF" },
    );
    assert.deepEqual(
      parseInputCommand({ kind: "aurora", action: "setBrightness", value: 140 }),
      { kind: "aurora", action: "setBrightness", value: 100 },
    );
    assert.deepEqual(
      parseInputCommand({ kind: "aurora", action: "setZone", zone: "Bezel outer ring", enabled: true }),
      { kind: "aurora", action: "setZone", zone: "Bezel outer ring", enabled: true },
    );
    assert.equal(parseInputCommand({ kind: "aurora", action: "setColor", color: "red" }), null);
    assert.equal(
      parseInputCommand({ kind: "aurora", action: "setZone", zone: "Firmware", enabled: true }),
      null,
    );
    assert.equal(
      parseInputCommand({ kind: "aurora", action: "setCustomIds", text: "73; Remove-Item" }),
      null,
    );
  });
});
