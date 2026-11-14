import { describe, expect, it } from "vitest";
import { CanvasDataError, emptyCanvas, parseCanvasData } from "./canvasData";

const stroke = {
  id: "a",
  seed: 1,
  color: "#000",
  size: 10,
  bleed: 0.2,
  dryness: 0.3,
  points: [{ x: 1, y: 2, p: 0.5, t: 0 }],
};
const stamp = { id: "st", assetId: "frog-run", x: 10, y: 20, scale: 1.5, rotation: 0.3, flipX: true };

describe("parseCanvasData (A2 / C6)", () => {
  it.each([null, undefined])("treats %s (priority-1 data) as an empty canvas", (raw) => {
    expect(parseCanvasData(raw)).toEqual(emptyCanvas());
    expect(emptyCanvas()).toEqual({ version: 2, strokes: [], stamps: [] });
  });

  it("parses valid version 2 data", () => {
    const raw = { version: 2, strokes: [stroke], stamps: [stamp] };
    expect(parseCanvasData(raw)).toEqual(raw);
  });

  it("migrates version 1 data by adding an empty stamps list", () => {
    expect(parseCanvasData({ version: 1, strokes: [stroke] })).toEqual({
      version: 2,
      strokes: [stroke],
      stamps: [],
    });
  });

  it("keeps stamps whose asset is unknown (asset removed in a later version)", () => {
    const raw = { version: 2, strokes: [], stamps: [{ ...stamp, assetId: "gone" }] };
    expect(parseCanvasData(raw).stamps[0].assetId).toBe("gone");
  });

  it("keeps the custom text of a bubble stamp", () => {
    const raw = { version: 2, strokes: [], stamps: [{ ...stamp, assetId: "phrase-custom", text: "美酒を飲まん" }] };
    expect(parseCanvasData(raw).stamps[0].text).toBe("美酒を飲まん");
    expect(parseCanvasData({ version: 2, strokes: [], stamps: [stamp] }).stamps[0]).not.toHaveProperty("text");
  });

  it.each([
    ["stamp bad text", { version: 2, strokes: [], stamps: [{ ...stamp, text: 3 }] }],
    ["non-object", "hello"],
    ["array", []],
    ["missing version", { strokes: [] }],
    ["unknown version", { version: 3, strokes: [], stamps: [] }],
    ["strokes not an array", { version: 1, strokes: {} }],
    ["stroke not an object", { version: 1, strokes: [1] }],
    ["stroke missing id", { version: 1, strokes: [{ ...stroke, id: 3 }] }],
    ["non-finite size", { version: 1, strokes: [{ ...stroke, size: Number.NaN }] }],
    ["bad color", { version: 1, strokes: [{ ...stroke, color: null }] }],
    ["points not an array", { version: 1, strokes: [{ ...stroke, points: "x" }] }],
    ["bad point", { version: 1, strokes: [{ ...stroke, points: [{ x: 1, y: 2, p: "a", t: 0 }] }] }],
    ["null point", { version: 1, strokes: [{ ...stroke, points: [null] }] }],
    ["v2 without stamps", { version: 2, strokes: [] }],
    ["stamp not an object", { version: 2, strokes: [], stamps: [null] }],
    ["stamp bad id", { version: 2, strokes: [], stamps: [{ ...stamp, id: 1 }] }],
    ["stamp bad assetId", { version: 2, strokes: [], stamps: [{ ...stamp, assetId: null }] }],
    ["stamp bad number", { version: 2, strokes: [], stamps: [{ ...stamp, x: Infinity }] }],
    ["stamp zero scale", { version: 2, strokes: [], stamps: [{ ...stamp, scale: 0 }] }],
    ["stamp bad flipX", { version: 2, strokes: [], stamps: [{ ...stamp, flipX: "yes" }] }],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseCanvasData(raw)).toThrow(CanvasDataError);
  });
});
