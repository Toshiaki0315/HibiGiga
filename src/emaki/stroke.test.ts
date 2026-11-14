import { describe, expect, it } from "vitest";
import {
  MIN_WIDTH_RATIO,
  appendPoint,
  computeWidths,
  decimate,
  smooth,
  widthAt,
  type StrokePoint,
} from "./stroke";

const pt = (x: number, y = 0, t = x, p = 0.5): StrokePoint => ({ x, y, p, t });

describe("decimate / appendPoint (C4)", () => {
  it("drops points closer than minDist but keeps first and last", () => {
    const pts = [pt(0), pt(0.5), pt(1), pt(3), pt(3.2)];
    expect(decimate(pts, 2).map((p) => p.x)).toEqual([0, 3, 3.2]);
  });

  it("returns short inputs unchanged", () => {
    expect(decimate([], 2)).toEqual([]);
    expect(decimate([pt(1)], 2)).toEqual([pt(1)]);
  });

  it("appendPoint adds only when far enough from the last point", () => {
    expect(appendPoint([], pt(0), 2)).toEqual([pt(0)]);
    expect(appendPoint([pt(0)], pt(1), 2)).toEqual([pt(0)]);
    expect(appendPoint([pt(0)], pt(2), 2)).toEqual([pt(0), pt(2)]);
  });

  it("appendPoint does not mutate the input array", () => {
    const pts = [pt(0)];
    appendPoint(pts, pt(5), 2);
    expect(pts).toHaveLength(1);
  });
});

describe("widthAt (C4)", () => {
  const size = 20;

  it("stays within [size * MIN_WIDTH_RATIO, size]", () => {
    for (const p of [0, 0.3, 1]) {
      for (const speed of [0, 1, 10, 1000]) {
        const w = widthAt(p, speed, size);
        expect(w).toBeGreaterThanOrEqual(size * MIN_WIDTH_RATIO);
        expect(w).toBeLessThanOrEqual(size);
      }
    }
  });

  it("grows with pressure", () => {
    expect(widthAt(0.2, 0, size)).toBeLessThan(widthAt(0.5, 0, size));
    expect(widthAt(0.5, 0, size)).toBeLessThan(widthAt(1, 0, size));
    expect(widthAt(1, 0, size)).toBe(size);
  });

  it("gets thinner when moving faster", () => {
    expect(widthAt(0.5, 2, size)).toBeLessThan(widthAt(0.5, 0.1, size));
  });

  it("clamps out-of-range and non-finite pressure", () => {
    expect(widthAt(2, 0, size)).toBe(widthAt(1, 0, size));
    expect(widthAt(-1, 0, size)).toBe(widthAt(0, 0, size));
    expect(widthAt(Number.NaN, 0, size)).toBe(widthAt(0, 0, size));
  });
});

describe("computeWidths (C4)", () => {
  it("returns one width per point", () => {
    expect(computeWidths([], 10)).toEqual([]);
    expect(computeWidths([pt(0)], 10)).toEqual([widthAt(0.5, 0, 10)]);
    expect(computeWidths([pt(0), pt(10), pt(20)], 10)).toHaveLength(3);
  });

  it("uses distance / elapsed time as speed (fast segment is thinner)", () => {
    const slow = { ...pt(10), t: 100 };
    const fast = { ...pt(110), t: 110 };
    const [, wSlow, wFast] = computeWidths([pt(0, 0, 0), slow, fast], 10);
    expect(wFast).toBeLessThan(wSlow);
  });

  it("treats zero elapsed time safely", () => {
    const ws = computeWidths([pt(0, 0, 5), pt(10, 0, 5)], 10);
    ws.forEach((w) => expect(Number.isFinite(w)).toBe(true));
  });
});

describe("smooth (C4)", () => {
  it("keeps endpoints and passes through every original point", () => {
    const pts = [pt(0, 0), pt(10, 10), pt(20, 0), pt(30, 10)];
    const s = smooth(pts, 4);
    expect(s).toHaveLength((pts.length - 1) * 4 + 1);
    pts.forEach((p, i) => expect(s[i * 4]).toEqual(p));
  });

  it("interpolates between points", () => {
    const s = smooth([pt(0), pt(10), pt(20)], 2);
    expect(s[1].x).toBeGreaterThan(0);
    expect(s[1].x).toBeLessThan(10);
    expect(s[1].p).toBeCloseTo(0.5);
  });

  it("returns copies for fewer than 2 points", () => {
    expect(smooth([], 4)).toEqual([]);
    expect(smooth([pt(3)], 4)).toEqual([pt(3)]);
  });
});
