import { describe, expect, it } from "vitest";
import { callsOf, createRecordingContext, type RecordingContext } from "../test/fakeCanvas";
import { generateDabs } from "./brush";
import { LABEL_MARGIN, buildLayout } from "./layout";
import { LayerCache } from "./layerCache";
import { drawEmaki } from "./render";
import type { DayState } from "./store";
import type { Stamp } from "./canvasData";
import type { Stroke } from "./stroke";

const stroke: Stroke = {
  id: "s",
  seed: 3,
  color: "#123",
  size: 10,
  bleed: 0,
  dryness: 0,
  points: [{ x: 100, y: 100, p: 0.5, t: 0 }],
};
const layout = buildLayout(["2026-11-13", "2026-11-14", "2026-11-15"], {
  dayWidth: 1000,
  direction: "rtl",
});
const vp = { scrollX: 500, width: 1000, height: 400 };
const text = (ctx: RecordingContext) => callsOf(ctx, "fillText").map((c) => c.args[0]).join("");
const ready = (strokes: Stroke[] = [], stamps: Stamp[] = []): DayState => ({
  status: "ready",
  text: "",
  canvas: { version: 2, strokes, stamps },
});
const stamp: Stamp = { id: "st", assetId: "frog-run", x: 300, y: 150, scale: 1, rotation: 0, flipX: false };

describe("drawEmaki (C8)", () => {
  it("clears and paints the washi background over the viewport", () => {
    const ctx = createRecordingContext();
    drawEmaki(ctx, { layout, viewport: vp, days: {} });
    expect(callsOf(ctx, "clearRect")[0].args).toEqual([0, 0, 1000, 400]);
    expect(callsOf(ctx, "fillRect")[0].args).toEqual([0, 0, 1000, 400]);
  });

  it("draws date labels only for visible days", () => {
    const ctx = createRecordingContext();
    drawEmaki(ctx, { layout, viewport: vp, days: {} });
    // scrollX=500..1500 → 2026-11-15 (x=0) と 2026-11-14 (x=1000) が見える
    expect(text(ctx)).toContain("十一月十五日");
    expect(text(ctx)).toContain("十一月十四日");
    expect(text(ctx)).not.toContain("十一月十三日");
  });

  it("draws a boundary line at each visible day edge", () => {
    const ctx = createRecordingContext();
    drawEmaki(ctx, { layout, viewport: vp, days: {} });
    const xs = callsOf(ctx, "moveTo").map((c) => c.args[0]);
    expect(xs).toEqual([-500, 500]);
  });

  it("draws strokes of ready days at their screen position", () => {
    const ctx = createRecordingContext();
    drawEmaki(ctx, { layout, viewport: vp, days: { "2026-11-14": ready([stroke]) } });
    const arcs = callsOf(ctx, "arc");
    const dabs = generateDabs(stroke);
    expect(arcs).toHaveLength(dabs.length);
    expect(arcs[0].args[0]).toBe(1000 - 500 + dabs[0].x);
  });

  it("shows a notice for days that failed to load or have a broken canvas", () => {
    const ctx = createRecordingContext();
    drawEmaki(ctx, {
      layout,
      viewport: vp,
      days: {
        "2026-11-15": { status: "error", message: "x" },
        "2026-11-14": { status: "canvasError", text: "", rawCanvas: 1, message: "y" },
      },
    });
    expect(text(ctx)).toContain("読み込めず");
    expect(text(ctx)).toContain("絵が損なわれておる");
    expect(callsOf(ctx, "arc")).toHaveLength(0);
  });

  it("draws the stroke currently being drawn", () => {
    const ctx = createRecordingContext();
    drawEmaki(ctx, {
      layout,
      viewport: vp,
      days: {},
      current: { date: "2026-11-15", stroke },
    });
    expect(callsOf(ctx, "arc").length).toBe(generateDabs(stroke).length);
  });

  it("skips the current stroke if its day is not in the layout", () => {
    const ctx = createRecordingContext();
    drawEmaki(ctx, { layout, viewport: vp, days: {}, current: { date: "2000-01-01", stroke } });
    expect(callsOf(ctx, "arc")).toHaveLength(0);
  });

  describe("sticky date labels (A4)", () => {
    const labelX = (ctx: RecordingContext, ch: string) =>
      callsOf(ctx, "fillText").filter((c) => c.args[0] === ch).map((c) => c.args[1]);

    it("rtl: pins the label to the screen edge while the day's start edge is off-screen", () => {
      const ctx = createRecordingContext();
      // 2026-11-14 (x=1000..2000) の中ほどだけが見えている
      drawEmaki(ctx, { layout, viewport: { scrollX: 1200, width: 600, height: 400 }, days: {} });
      expect(labelX(ctx, "四")).toEqual([600 - LABEL_MARGIN]);
    });

    it("keeps the label inside its own day when the day is leaving the screen", () => {
      const ctx = createRecordingContext();
      // 2026-11-14 は画面左端に 300px だけ見え、2026-11-13 が右側を占める
      drawEmaki(ctx, { layout, viewport: { scrollX: 1700, width: 600, height: 400 }, days: {} });
      expect(labelX(ctx, "四")).toEqual([2000 - LABEL_MARGIN - 1700]);
      expect(labelX(ctx, "三")).toEqual([600 - LABEL_MARGIN]);
    });

    it("ltr: pins the label to the left screen edge", () => {
      const ltr = buildLayout(["2026-11-13", "2026-11-14"], { dayWidth: 1000, direction: "ltr" });
      const ctx = createRecordingContext();
      drawEmaki(ctx, { layout: ltr, viewport: { scrollX: 1200, width: 600, height: 400 }, days: {} });
      expect(labelX(ctx, "四")).toEqual([LABEL_MARGIN]);
    });
  });

  describe("with a LayerCache", () => {
    it("draws saved strokes as one bitmap per day instead of per-dab arcs", () => {
      const ctx = createRecordingContext();
      const layers = new LayerCache();
      const strokes = [stroke];
      const days = { "2026-11-14": ready(strokes), "2026-11-15": ready([]) };
      drawEmaki(ctx, { layout, viewport: vp, days, layers, dpr: 1 });
      expect(callsOf(ctx, "arc")).toHaveLength(0);
      const images = callsOf(ctx, "drawImage");
      expect(images).toHaveLength(1);
      const layer = layers.get("2026-11-14", strokes, 1000, 400, 1)!;
      expect(images[0].args).toEqual([layer.canvas, 1000 - 500 + layer.x0, 0, layer.width, 400]);
    });

    it("still draws the in-progress stroke live on top", () => {
      const ctx = createRecordingContext();
      drawEmaki(ctx, {
        layout,
        viewport: vp,
        days: { "2026-11-15": ready([stroke]) },
        current: { date: "2026-11-15", stroke },
        layers: new LayerCache(),
        dpr: 1,
      });
      expect(callsOf(ctx, "arc")).toHaveLength(generateDabs(stroke).length);
      expect(callsOf(ctx, "drawImage")).toHaveLength(1);
    });

    it("evicts layers of days scrolled out of view", () => {
      const layers = new LayerCache();
      layers.get("2026-11-13", [stroke], 1000, 400, 1);
      drawEmaki(createRecordingContext(), { layout, viewport: vp, days: {}, layers, dpr: 1 });
      expect(layers.size).toBe(0);
    });
  });

  describe("stamps (A8)", () => {
    it("draws stamps of ready days without a cache", () => {
      const ctx = createRecordingContext();
      drawEmaki(ctx, { layout, viewport: vp, days: { "2026-11-14": ready([], [stamp]) } });
      expect(callsOf(ctx, "translate")[0].args).toEqual([1000 - 500 + 300, 150]);
    });

    it("draws the floating (dragged) stamp live and keeps it out of the cached layer", () => {
      const ctx = createRecordingContext();
      const moved = { ...stamp, x: 350 };
      drawEmaki(ctx, {
        layout,
        viewport: vp,
        days: { "2026-11-14": ready([], [stamp]) },
        layers: new LayerCache(),
        dpr: 1,
        floating: { date: "2026-11-14", stamp: moved },
      });
      expect(callsOf(ctx, "drawImage")).toHaveLength(0);
      expect(callsOf(ctx, "translate")[0].args).toEqual([1000 - 500 + 350, 150]);
    });

    it("draws the selection outline on top", () => {
      const ctx = createRecordingContext();
      drawEmaki(ctx, {
        layout,
        viewport: vp,
        days: {},
        selection: { date: "2026-11-14", stamp },
      });
      expect(callsOf(ctx, "setLineDash").length).toBeGreaterThan(0);
      expect(callsOf(ctx, "arc")).toHaveLength(5);
    });

    it("skips floating stamps and selections for days outside the layout", () => {
      const ctx = createRecordingContext();
      drawEmaki(ctx, {
        layout,
        viewport: vp,
        days: {},
        floating: { date: "2000-01-01", stamp },
        selection: { date: "2000-01-01", stamp },
      });
      expect(callsOf(ctx, "translate")).toHaveLength(0);
      expect(callsOf(ctx, "setLineDash")).toHaveLength(0);
    });
  });

  it("passes the user asset version to the layer cache", () => {
    const layers = new LayerCache();
    const days = { "2026-11-14": ready([stroke]) };
    const draw = (assetsVersion: number) => {
      const ctx = createRecordingContext();
      drawEmaki(ctx, { layout, viewport: vp, days, layers, dpr: 1, assetsVersion });
      return callsOf(ctx, "drawImage")[0].args[0];
    };
    const first = draw(1);
    expect(draw(1)).toBe(first);
    expect(draw(2)).not.toBe(first);
  });
});
