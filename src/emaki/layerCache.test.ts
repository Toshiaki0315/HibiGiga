import { describe, expect, it } from "vitest";
import { callsOf, type RecordingContext } from "../test/fakeCanvas";
import { getDabs } from "./brush";
import { LayerCache } from "./layerCache";
import type { Stamp } from "./canvasData";
import { stampBounds } from "./stampGeometry";
import { sizeOfStamp } from "./stampRender";
import type { Stroke } from "./stroke";

const mk = (x: number, id = "s"): Stroke => ({
  id,
  seed: 1,
  color: "#000",
  size: 10,
  bleed: 0,
  dryness: 0,
  points: [
    { x, y: 50, p: 0.5, t: 0 },
    { x: x + 40, y: 60, p: 0.5, t: 16 },
  ],
});
const ctxOf = (c: HTMLCanvasElement) => c.getContext("2d") as unknown as RecordingContext;
const arcs = (c: HTMLCanvasElement) => callsOf(ctxOf(c), "arc").length;

describe("LayerCache", () => {
  it("L1: renders a day's strokes once and reuses the bitmap for the same strokes", () => {
    const cache = new LayerCache();
    const strokes = [mk(100)];
    const a = cache.get("2026-11-15", strokes, 1000, 400, 1)!;
    const drawn = arcs(a.canvas);
    expect(drawn).toBe(getDabs(strokes[0]).length);
    const b = cache.get("2026-11-15", strokes, 1000, 400, 1)!;
    expect(b).toBe(a);
    expect(arcs(b.canvas)).toBe(drawn);
  });

  it("L2: re-renders when the strokes array changes (a stroke was added)", () => {
    const cache = new LayerCache();
    const first = [mk(100)];
    const a = cache.get("d", first, 1000, 400, 1)!;
    const b = cache.get("d", [...first, mk(300, "t")], 1000, 400, 1)!;
    expect(b).not.toBe(a);
    expect(arcs(b.canvas)).toBe(getDabs(first[0]).length + getDabs(mk(300, "t")).length);
  });

  it("L3: re-renders when height, day width or pixel ratio changes", () => {
    const cache = new LayerCache();
    const s = [mk(100)];
    const a = cache.get("d", s, 1000, 400, 1);
    const b = cache.get("d", s, 1000, 500, 1);
    const c = cache.get("d", s, 1000, 500, 2);
    const d = cache.get("d", s, 1200, 500, 2);
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("L4: sizes the bitmap in device pixels and scales drawing by the pixel ratio", () => {
    const layer = new LayerCache().get("d", [mk(100)], 1000, 400, 2)!;
    expect(layer.width).toBeGreaterThanOrEqual(1000);
    expect(layer.canvas.width).toBe(layer.width * 2);
    expect(layer.canvas.height).toBe(800);
    expect(callsOf(ctxOf(layer.canvas), "setTransform")[0].args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it("L5: extends the bitmap to cover strokes that leave the day (no clipping)", () => {
    const layer = new LayerCache().get("d", [mk(-80), mk(1050, "t")], 1000, 400, 1)!;
    expect(layer.x0).toBeLessThan(-80);
    expect(layer.x0 + layer.width).toBeGreaterThan(1090);
    // ストロークは x0 を原点として描かれる
    const firstArc = callsOf(ctxOf(layer.canvas), "arc")[0].args[0] as number;
    expect(firstArc).toBeCloseTo(getDabs(mk(-80))[0].x - layer.x0);
  });

  it("L6: returns null for a day without strokes", () => {
    expect(new LayerCache().get("d", [], 1000, 400, 1)).toBeNull();
  });

  it("L7: retain evicts layers of days no longer visible", () => {
    const cache = new LayerCache();
    cache.get("a", [mk(1)], 1000, 400, 1);
    cache.get("b", [mk(1)], 1000, 400, 1);
    cache.retain(["b"]);
    expect(cache.size).toBe(1);
    const before = cache.get("b", [mk(1)], 1000, 400, 1);
    expect(before).not.toBeNull();
  });

  const stamp = (id: string, x = 300): Stamp => ({
    id,
    assetId: "frog-run",
    x,
    y: 150,
    scale: 1,
    rotation: 0,
    flipX: false,
  });

  it("L8: draws stamps into the layer underneath the strokes", () => {
    const layer = new LayerCache().get("d", [mk(100)], 1000, 400, 1, [stamp("a")])!;
    const ops = ctxOf(layer.canvas).calls.map((c) => c.op);
    // setTransform の直後はスタンプ (save → translate)
    expect(ops.slice(1, 3)).toEqual(["save", "translate"]);
  });

  it("L9: leaves out the excluded (being dragged) stamp and caches per exclusion", () => {
    const cache = new LayerCache();
    const stamps = [stamp("a"), stamp("b", 500)];
    const noStrokes: Stroke[] = [];
    const all = cache.get("d", noStrokes, 1000, 400, 1, stamps)!;
    const without = cache.get("d", noStrokes, 1000, 400, 1, stamps, "b")!;
    expect(without).not.toBe(all);
    expect(callsOf(ctxOf(without.canvas), "translate")).toHaveLength(1);
    expect(cache.get("d", noStrokes, 1000, 400, 1, stamps, "b")).toBe(without);
  });

  it("L10: returns a layer for stamp-only days and null when only the excluded stamp is left", () => {
    const cache = new LayerCache();
    expect(cache.get("d", [], 1000, 400, 1, [stamp("a")])).not.toBeNull();
    expect(cache.get("d", [], 1000, 400, 1, [stamp("a")], "a")).toBeNull();
  });

  it("L11: extends the bitmap to cover stamps hanging over the day edge", () => {
    const s = stamp("a", 990);
    const layer = new LayerCache().get("d", [], 1000, 400, 1, [s])!;
    expect(layer.x0 + layer.width).toBeGreaterThan(stampBounds(s, sizeOfStamp(s)).maxX);
  });

  it("L12: re-renders when the user asset version changes (an image finished loading)", () => {
    const cache = new LayerCache();
    const strokes = [mk(100)];
    const stamps = [stamp("a")];
    const v1 = cache.get("d", strokes, 1000, 400, 1, stamps, undefined, 1);
    expect(cache.get("d", strokes, 1000, 400, 1, stamps, undefined, 1)).toBe(v1);
    expect(cache.get("d", strokes, 1000, 400, 1, stamps, undefined, 2)).not.toBe(v1);
  });
});
