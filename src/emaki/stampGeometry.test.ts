import { describe, expect, it } from "vitest";
import type { Stamp } from "./canvasData";
import {
  HANDLE_RADIUS,
  MAX_SCALE,
  MIN_SCALE,
  ROTATE_HANDLE_OFFSET,
  contains,
  corners,
  fromStampLocal,
  handleAt,
  hitTest,
  moveBy,
  resizeTo,
  rotateHandlePos,
  rotateTo,
  stampBounds,
  toStampLocal,
} from "./stampGeometry";

const size = { w: 100, h: 60 };
const st = (o: Partial<Stamp> = {}): Stamp => ({
  id: "s",
  assetId: "a",
  x: 200,
  y: 150,
  scale: 1,
  rotation: 0,
  flipX: false,
  ...o,
});
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("stamp transform (A3)", () => {
  it.each([
    st(),
    st({ rotation: 0.7 }),
    st({ scale: 2.5, rotation: -1.2 }),
    st({ scale: 0.5, rotation: 3, flipX: true }),
  ])("round-trips world → local → world (%#)", (s) => {
    for (const p of [{ x: 0, y: 0 }, { x: 230, y: 140 }, { x: -50, y: 900 }]) {
      close(fromStampLocal(s, toStampLocal(s, p)), p);
    }
  });

  it("maps the center to local (0, 0) and applies scale, rotation and flip", () => {
    close(toStampLocal(st(), { x: 200, y: 150 }), { x: 0, y: 0 });
    close(fromStampLocal(st({ scale: 2 }), { x: 10, y: 0 }), { x: 220, y: 150 });
    close(fromStampLocal(st({ rotation: Math.PI / 2 }), { x: 10, y: 0 }), { x: 200, y: 160 });
    close(fromStampLocal(st({ flipX: true }), { x: 10, y: 0 }), { x: 190, y: 150 });
  });

  it("returns the four rotated corners (tl, tr, br, bl)", () => {
    const c = corners(st({ scale: 2 }), size);
    close(c[0], { x: 100, y: 90 });
    close(c[2], { x: 300, y: 210 });
    const r = corners(st({ rotation: Math.PI / 2 }), size);
    close(r[0], { x: 230, y: 100 });
  });

  it("computes the axis-aligned bounds of a rotated stamp", () => {
    expect(stampBounds(st({ rotation: Math.PI / 2 }), size)).toEqual({
      minX: expect.closeTo(170),
      maxX: expect.closeTo(230),
      minY: expect.closeTo(100),
      maxY: expect.closeTo(200),
    });
  });
});

describe("hit testing (A3)", () => {
  it("contains points inside the rotated box only", () => {
    const s = st({ rotation: Math.PI / 2 });
    expect(contains(s, size, { x: 200, y: 195 })).toBe(true);
    expect(contains(s, size, { x: 245, y: 150 })).toBe(false);
  });

  it("picks the topmost (last) stamp under the point", () => {
    const a = st({ id: "a" });
    const b = st({ id: "b", x: 220 });
    const sizeOf = () => size;
    expect(hitTest([a, b], sizeOf, { x: 210, y: 150 })?.id).toBe("b");
    expect(hitTest([a, b], sizeOf, { x: 160, y: 150 })?.id).toBe("a");
    expect(hitTest([a, b], sizeOf, { x: 0, y: 0 })).toBeNull();
  });

  it("detects the scale handle at any corner and the rotate handle above the top edge", () => {
    const s = st({ scale: 2, rotation: 0.3 });
    for (const c of corners(s, size)) expect(handleAt(s, size, { x: c.x + 3, y: c.y - 3 })).toBe("scale");
    const r = rotateHandlePos(s, size);
    expect(handleAt(s, size, r)).toBe("rotate");
    expect(handleAt(s, size, { x: 200, y: 150 })).toBeNull();
    expect(HANDLE_RADIUS).toBeGreaterThan(0);
  });

  it("keeps the rotate handle a fixed on-screen distance above the top edge", () => {
    for (const scale of [0.5, 3]) {
      const s = st({ scale });
      const r = rotateHandlePos(s, size);
      expect(r.x).toBeCloseTo(200);
      expect(150 - (size.h / 2) * scale - r.y).toBeCloseTo(ROTATE_HANDLE_OFFSET);
    }
  });
});

describe("manipulation (A3)", () => {
  it("moveBy translates and does not mutate", () => {
    const s = st();
    expect(moveBy(s, 5, -7)).toMatchObject({ x: 205, y: 143 });
    expect(s.x).toBe(200);
  });

  it("resizeTo scales uniformly around the center so the corner follows the pointer", () => {
    const halfDiag = Math.hypot(50, 30);
    const r = resizeTo(st(), size, { x: 200 + 100, y: 150 + 60 });
    expect(r.scale).toBeCloseTo(Math.hypot(100, 60) / halfDiag);
    expect(r).toMatchObject({ x: 200, y: 150 });
  });

  it("resizeTo clamps the scale", () => {
    expect(resizeTo(st(), size, { x: 200, y: 150 }).scale).toBe(MIN_SCALE);
    expect(resizeTo(st(), size, { x: 99999, y: 150 }).scale).toBe(MAX_SCALE);
  });

  it("rotateTo points the top of the stamp toward the pointer", () => {
    expect(rotateTo(st(), { x: 200, y: 50 }, false).rotation).toBeCloseTo(0);
    expect(rotateTo(st(), { x: 300, y: 150 }, false).rotation).toBeCloseTo(Math.PI / 2);
    expect(rotateTo(st(), { x: 200, y: 250 }, false).rotation).toBeCloseTo(Math.PI);
  });

  it("rotateTo snaps to 15 degrees when requested", () => {
    const deg = (r: number) => (r * 180) / Math.PI;
    const p = { x: 200 + Math.sin(0.3) * 100, y: 150 - Math.cos(0.3) * 100 }; // 約17.2°
    expect(deg(rotateTo(st(), p, true).rotation)).toBeCloseTo(15);
    expect(deg(rotateTo(st(), p, false).rotation)).toBeCloseTo(17.19, 1);
  });
});
