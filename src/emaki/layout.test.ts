import { describe, expect, it } from "vitest";
import { LABEL_MARGIN, buildLayout, locate, scrollToDate, visibleSegments } from "./layout";
import type { Direction } from "./viewport";

const dates = ["2026-11-15", "2026-11-13", "2026-11-14"];
const W = 1000;
const vp = (scrollX: number, width = 1500) => ({ scrollX, width, height: 600 });

describe("buildLayout (C3)", () => {
  it("rtl: oldest day at the right end, newest at the left, packed without gaps", () => {
    const l = buildLayout(dates, { dayWidth: W, direction: "rtl" });
    expect(l.contentWidth).toBe(3000);
    expect(l.segments.map((s) => [s.date, s.x])).toEqual([
      ["2026-11-13", 2000],
      ["2026-11-14", 1000],
      ["2026-11-15", 0],
    ]);
  });

  it("ltr: oldest day at the left end", () => {
    const l = buildLayout(dates, { dayWidth: W, direction: "ltr" });
    expect(l.segments.map((s) => [s.date, s.x])).toEqual([
      ["2026-11-13", 0],
      ["2026-11-14", 1000],
      ["2026-11-15", 2000],
    ]);
  });

  it("places the date label at the reading start of each day", () => {
    const rtl = buildLayout(["2026-11-15"], { dayWidth: W, direction: "rtl" });
    expect(rtl.segments[0].labelX).toBe(W - LABEL_MARGIN);
    const ltr = buildLayout(["2026-11-15"], { dayWidth: W, direction: "ltr" });
    expect(ltr.segments[0].labelX).toBe(LABEL_MARGIN);
  });

  it("removes duplicates and invalid dates", () => {
    const l = buildLayout(["2026-11-15", "bad", "2026-11-15", "2026-02-30"], {
      dayWidth: W,
      direction: "rtl",
    });
    expect(l.segments.map((s) => s.date)).toEqual(["2026-11-15"]);
  });

  it("handles an empty list", () => {
    const l = buildLayout([], { dayWidth: W, direction: "rtl" });
    expect(l.segments).toEqual([]);
    expect(l.contentWidth).toBe(0);
  });
});

describe.each<Direction>(["rtl", "ltr"])("queries (C3, %s)", (direction) => {
  const l = buildLayout(dates, { dayWidth: W, direction });
  const xOf = (d: string) => l.segments.find((s) => s.date === d)!.x;

  it("visibleSegments returns only intersecting days, sorted by x", () => {
    const vis = visibleSegments(l, vp(0, 1500));
    expect(vis.map((s) => s.x)).toEqual([0, 1000]);
  });

  it("visibleSegments includes the buffer zone", () => {
    expect(visibleSegments(l, vp(0, 900)).length).toBe(1);
    expect(visibleSegments(l, vp(0, 900), 200).length).toBe(2);
  });

  it("visibleSegments excludes a day that only touches the edge", () => {
    expect(visibleSegments(l, vp(1000, 1000)).map((s) => s.x)).toEqual([1000]);
  });

  it("locate maps world x to the day and local x", () => {
    const d = "2026-11-14";
    expect(locate(l, xOf(d) + 250)).toEqual({ segment: expect.objectContaining({ date: d }), localX: 250 });
  });

  it("locate assigns an exact boundary to the day starting there", () => {
    expect(locate(l, 1000)?.segment.x).toBe(1000);
    expect(locate(l, 1000)?.localX).toBe(0);
  });

  it("locate returns null outside the content", () => {
    expect(locate(l, -1)).toBeNull();
    expect(locate(l, 3000)).toBeNull();
  });

  it("scrollToDate centers the day and clamps", () => {
    expect(scrollToDate(l, "2026-11-14", 1200)).toBe(900);
    expect(scrollToDate(l, l.segments.find((s) => s.x === 0)!.date, 1500)).toBe(0);
    expect(scrollToDate(l, l.segments.find((s) => s.x === 2000)!.date, 1500)).toBe(1500);
  });

  it("scrollToDate shows the reading start (date label side) when the day is wider than the view", () => {
    const seg = l.segments.find((s) => s.date === "2026-11-14")!;
    const start = scrollToDate(l, "2026-11-14", 600)!;
    // ラベルが画面内に入る
    expect(seg.labelX).toBeGreaterThanOrEqual(start);
    expect(seg.labelX).toBeLessThan(start + 600);
    expect(start).toBe(direction === "rtl" ? seg.x + seg.width - 600 : seg.x);
  });

  it("scrollToDate returns null for an unknown date", () => {
    expect(scrollToDate(l, "2000-01-01", 500)).toBeNull();
  });
});
