import { describe, expect, it } from "vitest";
import { callsOf, createRecordingContext } from "../test/fakeCanvas";
import {
  BRISTLES,
  VERTICAL_PUNCT_SHIFT,
  VERTICAL_ROTATED,
  generateDabs,
  getDabs,
  mulberry32,
  renderStroke,
  renderVerticalText,
  type Dab,
} from "./brush";
import type { Stroke } from "./stroke";

/** y=50 の水平な直線 (長さ length) */
function line(overrides: Partial<Stroke> = {}, length = 600): Stroke {
  const points = Array.from({ length: length / 10 + 1 }, (_, i) => ({
    x: i * 10,
    y: 50,
    p: 0.6,
    t: i * 20,
  }));
  return {
    id: "s1",
    seed: 42,
    color: "#1f1b16",
    size: 16,
    bleed: 0,
    dryness: 0,
    points,
    ...overrides,
  };
}

const core = (d: Dab[]) => d.filter((x) => x.kind === "core");
const bleed = (d: Dab[]) => d.filter((x) => x.kind === "bleed");
const sampleCount = (d: Dab[]) => new Set(core(d).map((x) => x.progress)).size;

describe("mulberry32 (C5)", () => {
  it("is deterministic per seed and in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seqA = Array.from({ length: 100 }, a);
    expect(Array.from({ length: 100 }, b)).toEqual(seqA);
    seqA.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });

  it("differs between seeds", () => {
    const a = Array.from({ length: 5 }, mulberry32(1));
    const b = Array.from({ length: 5 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });
});

describe("generateDabs (C5)", () => {
  it("returns nothing for an empty stroke", () => {
    expect(generateDabs(line({ points: [] }))).toEqual([]);
  });

  it("draws a single point as a dot", () => {
    const d = generateDabs(line({ points: [{ x: 5, y: 5, p: 0.5, t: 0 }] }));
    expect(core(d)).toHaveLength(BRISTLES);
    core(d).forEach((x) => {
      expect(Math.hypot(x.x - 5, x.y - 5)).toBeLessThan(16);
      expect(x.progress).toBe(0);
    });
  });

  it("never produces NaN for duplicate points", () => {
    const pts = [
      { x: 0, y: 0, p: 0.5, t: 0 },
      { x: 0, y: 0, p: 0.5, t: 0 },
      { x: 30, y: 0, p: 0.5, t: 10 },
      { x: 30, y: 0, p: 0.5, t: 10 },
    ];
    const d = generateDabs(line({ points: pts, bleed: 0.5, dryness: 0.5 }));
    expect(d.length).toBeGreaterThan(0);
    d.forEach((x) => [x.x, x.y, x.r, x.alpha].forEach((v) => expect(Number.isFinite(v)).toBe(true)));
  });

  it("keeps all alpha values in (0, 1] and radii positive", () => {
    const d = generateDabs(line({ bleed: 1, dryness: 1 }));
    d.forEach((x) => {
      expect(x.alpha).toBeGreaterThan(0);
      expect(x.alpha).toBeLessThanOrEqual(1);
      expect(x.r).toBeGreaterThan(0);
    });
  });

  describe("にじみ (bleed)", () => {
    it("produces no bleed dabs when bleed = 0", () => {
      expect(bleed(generateDabs(line({ bleed: 0 })))).toHaveLength(0);
    });

    it("produces more and wider-spread bleed dabs as bleed increases", () => {
      const low = bleed(generateDabs(line({ bleed: 0.3 })));
      const high = bleed(generateDabs(line({ bleed: 1 })));
      expect(low.length).toBeGreaterThan(0);
      expect(high.length).toBeGreaterThan(low.length);
      const spread = (ds: Dab[]) => ds.reduce((s, x) => s + Math.abs(x.y - 50), 0) / ds.length;
      expect(spread(high)).toBeGreaterThan(spread(low));
    });

    it("draws bleed underneath the core", () => {
      const d = generateDabs(line({ bleed: 0.5 }));
      const lastBleed = d.map((x) => x.kind).lastIndexOf("bleed");
      const firstCore = d.map((x) => x.kind).indexOf("core");
      expect(lastBleed).toBeLessThan(firstCore);
    });
  });

  describe("かすれ (dryness)", () => {
    it("draws every bristle at every sample when dryness = 0", () => {
      const d = generateDabs(line({ dryness: 0 }));
      expect(core(d).length).toBe(sampleCount(d) * BRISTLES);
    });

    it("drops more bristles as dryness increases", () => {
      const ratio = (dry: number) => {
        const d = generateDabs(line({ dryness: dry }));
        return core(d).length / (sampleCount(d) * BRISTLES);
      };
      expect(ratio(0.8)).toBeLessThan(ratio(0.3));
      expect(ratio(0.3)).toBeLessThan(1);
    });

    it("makes dry gaps streaky: a bristle stays dry for runs, not single dots", () => {
    const d = generateDabs(line({ dryness: 0.6 }, 2000));
    const samples = [...new Set(core(d).map((x) => x.progress))];
    let runs = 0;
    let gaps = 0;
    for (let b = 0; b < BRISTLES; b++) {
      const inked = new Set(core(d).filter((x) => x.bristle === b).map((x) => x.progress));
      let prevDry = false;
      for (const p of samples) {
        const dry = !inked.has(p);
        if (dry) gaps++;
        if (dry && !prevDry) runs++;
        prevDry = dry;
      }
    }
    // 平均の途切れ長さ (サンプル数) が十分長い
    expect(gaps / runs).toBeGreaterThan(3);
  });

  it("drops bristles more often toward the end of the stroke (ink runs out)", () => {
      const d = core(generateDabs(line({ dryness: 0.6 }, 2000)));
      const first = d.filter((x) => x.progress < 1 / 3).length;
      const last = d.filter((x) => x.progress > 2 / 3).length;
      expect(last).toBeLessThan(first);
    });
  });

  it("keeps each bristle continuous: consecutive dabs of a bristle overlap", () => {
    const d = core(generateDabs(line({ dryness: 0 })));
    for (let b = 0; b < BRISTLES; b++) {
      const own = d.filter((x) => x.bristle === b);
      expect(own.length).toBeGreaterThan(10);
      for (let i = 1; i < own.length; i++) {
        const gap = Math.hypot(own[i].x - own[i - 1].x, own[i].y - own[i - 1].y);
        expect(gap).toBeLessThanOrEqual(own[i].r + own[i - 1].r);
      }
    }
  });

  it("is deterministic for the same stroke and varies with the seed", () => {
    const s = line({ bleed: 0.5, dryness: 0.5 });
    expect(generateDabs(s)).toEqual(generateDabs(s));
    expect(generateDabs({ ...s, seed: 43 })).not.toEqual(generateDabs(s));
  });
});

describe("getDabs (cache)", () => {
  it("returns the cached dabs for the same stroke object", () => {
    const s = line({ bleed: 0.3 });
    expect(getDabs(s)).toBe(getDabs(s));
    expect(getDabs(s)).toEqual(generateDabs(s));
  });

  it("computes separately for a different stroke object", () => {
    const s = line();
    expect(getDabs({ ...s })).not.toBe(getDabs(s));
  });
});

describe("renderStroke (C5)", () => {
  it("draws one arc per dab, offset by originX, with the stroke color", () => {
    const s = line({ bleed: 0.4, dryness: 0.4 });
    const ctx = createRecordingContext();
    renderStroke(ctx, s, 1000);
    const dabs = generateDabs(s);
    const arcs = callsOf(ctx, "arc");
    expect(arcs).toHaveLength(dabs.length);
    expect(arcs[0].args.slice(0, 3)).toEqual([dabs[0].x + 1000, dabs[0].y, dabs[0].r]);
    expect(callsOf(ctx, "fill")).toHaveLength(dabs.length);
    expect(callsOf(ctx, "set:fillStyle")[0].args[0]).toBe("#1f1b16");
    expect(callsOf(ctx, "save")).toHaveLength(1);
    expect(callsOf(ctx, "restore")).toHaveLength(1);
  });

  it("issues identical commands when drawing the same stroke twice", () => {
    const s = line({ bleed: 0.7, dryness: 0.7 });
    const a = createRecordingContext();
    const b = createRecordingContext();
    renderStroke(a, s, 0);
    renderStroke(b, s, 0);
    expect(b.calls).toEqual(a.calls);
  });
});

describe("renderVerticalText (C5)", () => {
  it("rotates the long vowel mark, dashes and brackets 90° around their cell center", () => {
    const ctx = createRecordingContext();
    renderVerticalText(ctx, "あー「」", 100, 40, 20);
    const ops = ctx.calls.filter((c) => !c.op.startsWith("set:"));
    const rotated = (ch: string, cellTop: number) => [
      { op: "save", args: [] },
      { op: "translate", args: [100, cellTop + 10] },
      { op: "rotate", args: [Math.PI / 2] },
      { op: "fillText", args: [ch, 0, -10] },
      { op: "restore", args: [] },
    ];
    expect(ops).toEqual([
      { op: "fillText", args: ["あ", 100, 40] },
      ...rotated("ー", 60),
      ...rotated("「", 80),
      ...rotated("」", 100),
    ]);
  });

  it("covers the usual characters that need rotating", () => {
    for (const ch of ["ー", "〜", "～", "―", "…", "「", "」", "『", "』", "（", "）", "(", ")"]) {
      expect(VERTICAL_ROTATED.has(ch)).toBe(true);
    }
    expect(VERTICAL_ROTATED.has("あ")).toBe(false);
  });

  it("moves 。、，． to the top-right of their cell as in vertical writing", () => {
    const ctx = createRecordingContext();
    renderVerticalText(ctx, "疲れ。、，．", 100, 40, 20);
    expect(VERTICAL_PUNCT_SHIFT).toBeGreaterThan(0.3);
    expect(VERTICAL_PUNCT_SHIFT).toBeLessThan(1);
    const d = 20 * VERTICAL_PUNCT_SHIFT;
    expect(callsOf(ctx, "fillText").map((c) => c.args)).toEqual([
      ["疲", 100, 40],
      ["れ", 100, 60],
      ["。", 100 + d, 80 - d],
      ["、", 100 + d, 100 - d],
      ["，", 100 + d, 120 - d],
      ["．", 100 + d, 140 - d],
    ]);
  });

  it("draws characters top-to-bottom at the same x", () => {
    const ctx = createRecordingContext();
    renderVerticalText(ctx, "十一月", 100, 40, 24);
    expect(callsOf(ctx, "fillText").map((c) => c.args)).toEqual([
      ["十", 100, 40],
      ["一", 100, 64],
      ["月", 100, 88],
    ]);
  });
});
