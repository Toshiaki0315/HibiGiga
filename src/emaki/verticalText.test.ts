import { describe, expect, it } from "vitest";
import { BUBBLE_PAD_X, BUBBLE_PAD_Y, MAX_PER_COLUMN, bubbleSize, columnX, layoutVertical } from "./verticalText";

const F = 20;

describe("layoutVertical (F-K2)", () => {
  it("puts short text in one column", () => {
    expect(layoutVertical("おっとっと")).toEqual(["おっとっと"]);
  });

  it("wraps every MAX_PER_COLUMN characters", () => {
    const text = "本日も一日疲弊せり。美酒を飲まん。";
    const cols = layoutVertical(text);
    expect(MAX_PER_COLUMN).toBe(12);
    expect(cols).toEqual([text.slice(0, 12), text.slice(12)]);
  });

  it("starts a new column at each newline and drops empty lines", () => {
    expect(layoutVertical("一行目\n\n二行目")).toEqual(["一行目", "二行目"]);
  });

  it("counts surrogate pairs as one character", () => {
    expect(layoutVertical("𠮷".repeat(13))).toHaveLength(2);
  });

  it("returns no columns for blank text", () => {
    expect(layoutVertical("  \n ")).toEqual([]);
  });
});

describe("bubbleSize / columnX (F-K2)", () => {
  it("sizes the bubble from columns and the longest column", () => {
    expect(bubbleSize("おっとっと", F)).toEqual({ w: F + BUBBLE_PAD_X * 2, h: 5 * F + BUBBLE_PAD_Y * 2 });
    expect(bubbleSize("あ".repeat(30), F)).toEqual({ w: 3 * F + BUBBLE_PAD_X * 2, h: 12 * F + BUBBLE_PAD_Y * 2 });
  });

  it("keeps a minimum one-character bubble for blank text", () => {
    expect(bubbleSize("", F)).toEqual({ w: F + BUBBLE_PAD_X * 2, h: F + BUBBLE_PAD_Y * 2 });
  });

  it("lays columns out right to left around the center", () => {
    expect(columnX(0, 1, F)).toBe(0);
    expect([0, 1, 2].map((i) => columnX(i, 3, F))).toEqual([F, 0, -F]);
  });
});
