import { describe, expect, it } from "vitest";
import { PHRASE_FONT_SIZE, findAsset, type InkAsset } from "../assets/catalog";
import { bubbleSize } from "./verticalText";
import { callsOf, createRecordingContext } from "../test/fakeCanvas";
import { getDabs } from "./brush";
import type { Stamp } from "./canvasData";
import { corners } from "./stampGeometry";
import type { StampMeta } from "../api/stamps";
import {
  INK_FILTER,
  PLACEHOLDER_SIZE,
  USER_STAMP_EDGE,
  setUserAssetResolver,
  renderSelection,
  renderStamp,
  sizeOfStamp,
  stampSeed,
  stampStrokes,
} from "./stampRender";

const frog = findAsset("frog-run") as InkAsset;
const st = (o: Partial<Stamp> = {}): Stamp => ({
  id: "stamp-1",
  assetId: "frog-run",
  x: 100,
  y: 80,
  scale: 1.5,
  rotation: 0.4,
  flipX: false,
  ...o,
});

describe("stampSeed (A4)", () => {
  it("is a deterministic uint32 that differs between ids", () => {
    expect(stampSeed("abc")).toBe(stampSeed("abc"));
    expect(stampSeed("abc")).not.toBe(stampSeed("abd"));
    expect(Number.isInteger(stampSeed("x"))).toBe(true);
    expect(stampSeed("x")).toBeGreaterThanOrEqual(0);
    expect(stampSeed("x")).toBeLessThan(2 ** 32);
  });
});

describe("stampStrokes (A4)", () => {
  it("turns each asset line into a stroke centered on the asset", () => {
    const strokes = stampStrokes(frog, 7);
    expect(strokes).toHaveLength(frog.lines.length);
    const [x, y, p] = frog.lines[0][0];
    expect(strokes[0].points[0]).toMatchObject({ x: x - frog.width / 2, y: y - frog.height / 2, p });
    expect(strokes[0]).toMatchObject(frog.brush);
    expect(new Set(strokes.map((s) => s.seed)).size).toBe(strokes.length);
  });

  it("is cached per asset and seed", () => {
    expect(stampStrokes(frog, 7)).toBe(stampStrokes(frog, 7));
    expect(stampStrokes(frog, 8)).not.toBe(stampStrokes(frog, 7));
  });
});

describe("sizeOfStamp (A4 / F-K3)", () => {
  it("returns the ink asset size, the text bubble size, or a placeholder size", () => {
    expect(sizeOfStamp(st())).toEqual({ w: frog.width, h: frog.height });
    expect(sizeOfStamp(st({ assetId: "gone" }))).toEqual(PLACEHOLDER_SIZE);
    expect(sizeOfStamp(st({ assetId: "phrase-ottotto" }))).toEqual(bubbleSize("おっとっと", PHRASE_FONT_SIZE));
    const long = "本日も一日疲弊せり。美酒を飲まん。";
    expect(sizeOfStamp(st({ assetId: "phrase-custom", text: long }))).toEqual(bubbleSize(long, PHRASE_FONT_SIZE));
  });
});

describe("renderStamp (A4)", () => {
  it("transforms (translate → rotate → scale) around the drawing and restores", () => {
    const ctx = createRecordingContext();
    renderStamp(ctx, st(), 1000);
    const ops = ctx.calls.map((c) => c.op);
    expect(ops[0]).toBe("save");
    expect(ctx.calls.slice(1, 4)).toEqual([
      { op: "translate", args: [1100, 80] },
      { op: "rotate", args: [0.4] },
      { op: "scale", args: [1.5, 1.5] },
    ]);
    expect(ops.at(-1)).toBe("restore");
    const expected = stampStrokes(frog, stampSeed("stamp-1")).reduce((n, s) => n + getDabs(s).length, 0);
    expect(callsOf(ctx, "arc")).toHaveLength(expected);
  });

  it("mirrors with a negative x scale when flipped", () => {
    const ctx = createRecordingContext();
    renderStamp(ctx, st({ flipX: true }), 0);
    expect(callsOf(ctx, "scale")[0].args).toEqual([-1.5, 1.5]);
  });

  it("issues identical commands for the same stamp", () => {
    const a = createRecordingContext();
    const b = createRecordingContext();
    renderStamp(a, st(), 0);
    renderStamp(b, st(), 0);
    expect(b.calls).toEqual(a.calls);
  });

  it("draws a phrase as vertical text in a bubble and never mirrors the text", () => {
    const ctx = createRecordingContext();
    renderStamp(ctx, st({ assetId: "phrase-ottotto", flipX: true }), 0);
    expect(callsOf(ctx, "scale")[0].args).toEqual([1.5, 1.5]);
    expect(callsOf(ctx, "roundRect")).toHaveLength(1);
    const chars = callsOf(ctx, "fillText").map((c) => c.args[0]).join("");
    expect(chars).toBe("おっとっと");
    const ys = callsOf(ctx, "fillText").map((c) => c.args[2] as number);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
  });

  it("draws custom text from the stamp in right-to-left columns", () => {
    const ctx = createRecordingContext();
    const text = "本日も一日疲弊せり。美酒を飲まん。";
    renderStamp(ctx, st({ assetId: "phrase-custom", text, scale: 1, rotation: 0 }), 0);
    const calls = callsOf(ctx, "fillText");
    expect(calls.map((c) => c.args[0]).join("")).toBe(text);
    const firstColX = calls[0].args[1] as number;
    const lastColX = calls.at(-1)!.args[1] as number;
    expect(firstColX).toBeGreaterThan(lastColX);
  });

  it("draws a placeholder for an unknown asset", () => {
    const ctx = createRecordingContext();
    renderStamp(ctx, st({ assetId: "gone" }), 0);
    expect(callsOf(ctx, "strokeRect")).toHaveLength(1);
    expect(callsOf(ctx, "fillText")[0].args[0]).toBe("？");
  });
});

describe("renderSelection (A4)", () => {
  it("outlines the stamp and draws 4 scale handles and 1 rotate handle", () => {
    const ctx = createRecordingContext();
    const s = st();
    const size = sizeOfStamp(s);
    renderSelection(ctx, s, size, 1000);
    const c = corners(s, size);
    expect(callsOf(ctx, "moveTo")[0].args).toEqual([c[0].x + 1000, c[0].y]);
    expect(callsOf(ctx, "lineTo").slice(0, 3).map((l) => l.args)).toEqual(
      c.slice(1).map((p) => [p.x + 1000, p.y]),
    );
    expect(callsOf(ctx, "arc")).toHaveLength(5);
  });
});

describe("user stamps (I4)", () => {
  const meta = (style: StampMeta["style"]): StampMeta => ({
    id: "u1",
    name: "猫",
    width: 640,
    height: 480,
    style,
    createdAt: "2026-11-15T21:00:00+09:00",
  });
  const img = { tag: "img" } as unknown as CanvasImageSource;
  const resolve = (style: StampMeta["style"], loaded: boolean) =>
    setUserAssetResolver({
      meta: (id) => (id === "u1" ? meta(style) : undefined),
      image: () => (loaded ? img : undefined),
    });
  const user = (o: Partial<Stamp> = {}) => st({ assetId: "user:u1", scale: 1, rotation: 0, ...o });

  it("sizes a user stamp to fit USER_STAMP_EDGE, or a placeholder when unknown", () => {
    expect(sizeOfStamp(user())).toEqual(PLACEHOLDER_SIZE);
    resolve("original", true);
    expect(USER_STAMP_EDGE).toBe(160);
    expect(sizeOfStamp(user())).toEqual({ w: 160, h: 120 });
    expect(sizeOfStamp(user({ assetId: "user:zzz" }))).toEqual(PLACEHOLDER_SIZE);
  });

  it("draws the image as is for the original style", () => {
    resolve("original", true);
    const ctx = createRecordingContext();
    renderStamp(ctx, user(), 0);
    expect(callsOf(ctx, "drawImage")[0].args).toEqual([img, -80, -60, 160, 120]);
    expect(callsOf(ctx, "set:filter")).toHaveLength(0);
  });

  it("draws in ink style: grayscale + contrast, multiplied onto the paper", () => {
    resolve("ink", true);
    const ctx = createRecordingContext();
    renderStamp(ctx, user({ flipX: true }), 0);
    expect(callsOf(ctx, "set:filter")[0].args).toEqual([INK_FILTER]);
    expect(callsOf(ctx, "set:globalCompositeOperation")[0].args).toEqual(["multiply"]);
    expect(callsOf(ctx, "scale")[0].args).toEqual([-1, 1]);
    expect(callsOf(ctx, "drawImage")).toHaveLength(1);
  });

  it("draws a dashed frame while the image is loading", () => {
    resolve("original", false);
    const ctx = createRecordingContext();
    renderStamp(ctx, user(), 0);
    expect(callsOf(ctx, "setLineDash").length).toBeGreaterThan(0);
    expect(callsOf(ctx, "strokeRect")[0].args).toEqual([-80, -60, 160, 120]);
    expect(callsOf(ctx, "drawImage")).toHaveLength(0);
  });

  it("draws the placeholder for a deleted user stamp", () => {
    resolve("original", true);
    const ctx = createRecordingContext();
    renderStamp(ctx, user({ assetId: "user:zzz" }), 0);
    expect(callsOf(ctx, "fillText")[0].args[0]).toBe("？");
  });
});
