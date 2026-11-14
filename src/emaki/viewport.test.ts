import { describe, expect, it } from "vitest";
import {
  clampScroll,
  resizeViewport,
  screenToWorld,
  scrollBy,
  wheelToScroll,
  worldToScreen,
  type Viewport,
} from "./viewport";

const vp = (scrollX: number, width = 800): Viewport => ({ scrollX, width, height: 600 });

describe("coordinate conversion (C2)", () => {
  it("converts world → screen by subtracting scrollX", () => {
    expect(worldToScreen(vp(0), 100)).toBe(100);
    expect(worldToScreen(vp(250), 100)).toBe(-150);
  });

  it.each([0, 123.5, 5000])("round-trips screen → world → screen (scrollX=%s)", (s) => {
    for (const x of [0, 37, 799]) {
      expect(worldToScreen(vp(s), screenToWorld(vp(s), x))).toBe(x);
    }
  });
});

describe("clampScroll (C2)", () => {
  it("clamps into [0, contentWidth - width]", () => {
    expect(clampScroll(-10, 800, 3000)).toBe(0);
    expect(clampScroll(500, 800, 3000)).toBe(500);
    expect(clampScroll(2500, 800, 3000)).toBe(2200);
  });

  it("returns 0 when the content is narrower than the viewport", () => {
    expect(clampScroll(100, 800, 300)).toBe(0);
  });
});

describe("scrollBy (C2)", () => {
  it("moves by dx and stops at both ends", () => {
    expect(scrollBy(vp(100), 50, 3000).scrollX).toBe(150);
    expect(scrollBy(vp(100), -500, 3000).scrollX).toBe(0);
    expect(scrollBy(vp(2000), 999, 3000).scrollX).toBe(2200);
  });

  it("does not mutate the input viewport", () => {
    const v = vp(100);
    scrollBy(v, 50, 3000);
    expect(v.scrollX).toBe(100);
  });
});

describe("wheelToScroll (C2)", () => {
  const w = (deltaX: number, deltaY: number, deltaMode = 0) => ({ deltaX, deltaY, deltaMode });

  it("maps vertical wheel to forward reading direction", () => {
    expect(wheelToScroll(w(0, 100), "ltr", 800)).toBe(100);
    expect(wheelToScroll(w(0, 100), "rtl", 800)).toBe(-100);
  });

  it("uses horizontal delta as-is when it dominates", () => {
    expect(wheelToScroll(w(60, 10), "rtl", 800)).toBe(60);
    expect(wheelToScroll(w(-60, 10), "ltr", 800)).toBe(-60);
  });

  it("scales line and page delta modes", () => {
    expect(wheelToScroll(w(0, 3, 1), "ltr", 800)).toBe(48);
    expect(wheelToScroll(w(0, 1, 2), "ltr", 800)).toBe(800);
  });
});

describe("resizeViewport (C2)", () => {
  it("keeps the world point at the center fixed", () => {
    const r = resizeViewport(vp(1000, 800), 400, 300, 5000);
    expect(r).toEqual({ scrollX: 1200, width: 400, height: 300 });
    expect(r.scrollX + r.width / 2).toBe(1000 + 800 / 2);
  });

  it("clamps after resizing", () => {
    expect(resizeViewport(vp(0, 400), 1000, 600, 5000).scrollX).toBe(0);
    expect(resizeViewport(vp(4600, 400), 1000, 600, 5000).scrollX).toBe(4000);
  });
});
