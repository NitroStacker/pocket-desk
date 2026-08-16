import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSearchQuery } from "./shell.js";

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
