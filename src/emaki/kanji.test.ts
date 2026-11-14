import { describe, expect, it } from "vitest";
import { toKanjiDate, toKanjiNumber } from "./kanji";

describe("toKanjiNumber", () => {
  it.each([
    [1, "一"],
    [9, "九"],
    [10, "十"],
    [11, "十一"],
    [19, "十九"],
    [20, "二十"],
    [21, "二十一"],
    [30, "三十"],
    [31, "三十一"],
  ])("%i → %s", (n, s) => {
    expect(toKanjiNumber(n)).toBe(s);
  });

  it.each([0, -1, 100, 1.5, Number.NaN])("rejects %s", (n) => {
    expect(() => toKanjiNumber(n)).toThrow(RangeError);
  });
});

describe("toKanjiDate (C1)", () => {
  it.each([
    ["2026-11-15", "十一月十五日"],
    ["2026-01-01", "一月一日"],
    ["2026-12-10", "十二月十日"],
    ["2026-03-20", "三月二十日"],
    ["2026-05-31", "五月三十一日"],
  ])("%s → %s", (d, s) => {
    expect(toKanjiDate(d)).toBe(s);
  });

  it.each(["", "2026-02-30", "../x", "2026-1-1"])("throws on invalid date %j", (d) => {
    expect(() => toKanjiDate(d)).toThrow(RangeError);
  });
});
