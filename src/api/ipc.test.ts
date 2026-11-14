import { describe, expect, it } from "vitest";
import { normalizeIpcError } from "./ipc";

describe("normalizeIpcError", () => {
  const known = ["a", "b"] as const;

  it("keeps known kinds and the message", () => {
    expect(normalizeIpcError({ kind: "a", message: "m" }, known)).toEqual({ kind: "a", message: "m" });
  });

  it("maps unknown kinds, Errors and plain values to 'unknown'", () => {
    expect(normalizeIpcError({ kind: "zzz", message: "m" }, known)).toEqual({ kind: "unknown", message: "m" });
    expect(normalizeIpcError(new Error("e"), known)).toEqual({ kind: "unknown", message: "e" });
    expect(normalizeIpcError("s", known)).toEqual({ kind: "unknown", message: "s" });
    expect(normalizeIpcError(null, known)).toEqual({ kind: "unknown", message: "null" });
  });
});
