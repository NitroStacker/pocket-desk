import { describe, expect, it } from "vitest";
import { parseSocketProtocols } from "../src/auth";
import { isAllowedRelayMessage } from "../src/protocol";

describe("socket protocol parsing", () => {
  it("accepts a valid viewer credential", () => {
    const token = "a".repeat(64);
    expect(
      parseSocketProtocols(`pocketdesk-v1, viewer.${token}`),
    ).toEqual({ role: "viewer", token });
  });

  it("rejects missing protocol and malformed tokens", () => {
    expect(parseSocketProtocols(`viewer.${"a".repeat(64)}`)).toBeNull();
    expect(parseSocketProtocols("pocketdesk-v1, host.short")).toBeNull();
  });
});

describe("relay message allowlist", () => {
  it("keeps host and viewer capabilities separate", () => {
    expect(isAllowedRelayMessage("viewer", '{"type":"input"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"set-stream"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"request-shell"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"search-shell"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"launch-shell"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"request-icons"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"request-app-visual"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"request-camera-status"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"request-files"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"file-operation"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"request-file-download"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"camera-control"}')).toBe(true);
    expect(isAllowedRelayMessage("viewer", '{"type":"desktop-meta"}')).toBe(
      false,
    );
    expect(isAllowedRelayMessage("host", '{"type":"desktop-meta"}')).toBe(
      true,
    );
    expect(isAllowedRelayMessage("host", '{"type":"shell-snapshot"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"shell-results"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"app-icon"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"app-visual"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"camera-status"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"files-snapshot"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"file-thumbnail"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"file-download-chunk"}')).toBe(true);
    expect(isAllowedRelayMessage("host", '{"type":"input"}')).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(isAllowedRelayMessage("viewer", "not-json")).toBe(false);
  });
});
