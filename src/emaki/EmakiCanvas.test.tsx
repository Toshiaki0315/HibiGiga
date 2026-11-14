import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DiaryEntry } from "../api/diary";
import { callsOf, type RecordingContext } from "../test/fakeCanvas";
import type { Stamp } from "./canvasData";
import { EmakiCanvas, type EmakiCanvasHandle, type EmakiCanvasProps } from "./EmakiCanvas";
import { EmakiStore, type DiaryApi } from "./store";

const DATES = ["2026-11-13", "2026-11-14", "2026-11-15"];
const brush = { size: 12, bleed: 0.3, dryness: 0.4 };

function setup(props: Partial<EmakiCanvasProps> = {}, db: Record<string, DiaryEntry> = {}) {
  const api = {
    listDiaryDates: vi.fn(async () => DATES),
    loadDiary: vi.fn(async (d: string) => db[d] ?? null),
    saveDiary: vi.fn(async (e: DiaryEntry) => e),
  } satisfies DiaryApi;
  const store = new EmakiStore(api, "2026-11-15");
  const all: EmakiCanvasProps = {
    store,
    width: 1000,
    height: 400,
    dayWidth: 1000,
    direction: "rtl",
    mode: "brush",
    brush,
    focusDate: "2026-11-15",
    random: () => 0.5,
    now: () => 0,
    ...props,
  };
  const ref = createRef<EmakiCanvasHandle>();
  const utils = render(<EmakiCanvas ref={ref} {...all} />);
  const canvas = screen.getByTestId("emaki-canvas") as HTMLCanvasElement;
  const rerender = (p: Partial<EmakiCanvasProps>) =>
    utils.rerender(<EmakiCanvas ref={ref} {...all} {...p} />);
  return { api, store, canvas, rerender, ref };
}

const scrollX = (c: HTMLCanvasElement) => Number(c.dataset.scrollX);
const ctxOf = (c: HTMLCanvasElement) => c.getContext("2d") as unknown as RecordingContext;
const drawn = (c: HTMLCanvasElement) =>
  callsOf(ctxOf(c), "fillText").map((x) => x.args[0]).join("");

async function ready(c: HTMLCanvasElement, store: EmakiStore, date = "2026-11-15") {
  await act(() => store.init());
  await waitFor(() => expect(store.getSnapshot().days[date]?.status).toBe("ready"));
  return c;
}

describe("EmakiCanvas (C8)", () => {
  it("E1: loads visible days and draws their labels", async () => {
    const { api, store, canvas } = setup();
    await ready(canvas, store);
    expect(api.loadDiary).toHaveBeenCalledWith("2026-11-15");
    expect(api.loadDiary).not.toHaveBeenCalledWith("2026-11-13");
    expect(drawn(canvas)).toContain("十一月十五日");
    expect(canvas.width).toBe(1000);
    expect(canvas.style.width).toBe("1000px");
  });

  it("E2: scrolls to the focus date once it is laid out", async () => {
    const { store, canvas } = setup({ focusDate: "2026-11-13" });
    await ready(canvas, store, "2026-11-13");
    expect(scrollX(canvas)).toBe(2000);
  });

  it("E3: a brush drag saves a stroke to the day under the pointer", async () => {
    const { api, store, canvas } = setup();
    await ready(canvas, store);
    canvas.setPointerCapture = vi.fn();
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pressure: 0.8, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 60, pressure: 0.6, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 150.5, clientY: 60, pressure: 0.6, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 150, clientY: 60, pointerId: 1 });
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalledTimes(1));
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    const saved = api.saveDiary.mock.calls[0][0];
    expect(saved.date).toBe("2026-11-15");
    const [s] = (saved.canvas as { strokes: Array<Record<string, unknown>> }).strokes;
    expect(s).toMatchObject({ ...brush, color: "#1f1b16", seed: 2 ** 31 });
    expect(s.points).toEqual([
      { x: 100, y: 50, p: expect.closeTo(0.8), t: 0 },
      { x: 150, y: 60, p: expect.closeTo(0.6), t: 0 },
    ]);
  });

  it("E3: uses a default pressure for devices that report 0", async () => {
    const { api, store, canvas } = setup();
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pressure: 0 });
    fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalled());
    const s = (api.saveDiary.mock.calls[0][0].canvas as { strokes: Array<{ points: Array<{ p: number }> }> })
      .strokes[0];
    expect(s.points[0].p).toBe(0.5);
  });

  it("E4: a stroke crossing into the next day stays with the day it started on", async () => {
    const { api, store, canvas } = setup({ focusDate: "2026-11-14" });
    await ready(canvas, store, "2026-11-14");
    // scrollX=1000: 画面 x=990 は 2026-11-14 の区画 (x=1000..2000) の中
    fireEvent.pointerDown(canvas, { clientX: 990, clientY: 10, pressure: 0.5 });
    fireEvent.pointerMove(canvas, { clientX: 1100, clientY: 10, pressure: 0.5 });
    fireEvent.pointerUp(canvas, {});
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalled());
    expect(api.saveDiary.mock.calls[0][0].date).toBe("2026-11-14");
  });

  it("E5: ignores strokes on days that are not ready or outside the scroll", async () => {
    const { api, store, canvas } = setup({ width: 1500 }, {
      "2026-11-14": { date: "2026-11-14", text: "", canvas: "broken" },
    });
    await ready(canvas, store);
    await waitFor(() => expect(store.getSnapshot().days["2026-11-14"]?.status).toBe("canvasError"));
    fireEvent.pointerDown(canvas, { clientX: 1200, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 1250, clientY: 10 });
    fireEvent.pointerUp(canvas, {});
    expect(api.saveDiary).not.toHaveBeenCalled();
  });

  it("E5: ignores pointers outside the content", async () => {
    const api = {
      listDiaryDates: vi.fn(async () => []),
      loadDiary: vi.fn(async () => null),
      saveDiary: vi.fn(async (e: DiaryEntry) => e),
    };
    const store = new EmakiStore(api, "2026-11-15");
    render(
      <EmakiCanvas store={store} width={1500} height={400} dayWidth={1000} mode="brush" brush={brush} focusDate="2026-11-15" />,
    );
    const canvas = screen.getByTestId("emaki-canvas") as HTMLCanvasElement;
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 1200, clientY: 10 });
    fireEvent.pointerUp(canvas, {});
    expect(api.saveDiary).not.toHaveBeenCalled();
  });

  it("E6: the wheel scrolls in the reading direction", async () => {
    const { store, canvas } = setup({ focusDate: "2026-11-13" });
    await ready(canvas, store, "2026-11-13");
    fireEvent.wheel(canvas, { deltaY: 100 });
    expect(scrollX(canvas)).toBe(1900);
    fireEvent.wheel(canvas, { deltaY: -500 });
    expect(scrollX(canvas)).toBe(2000);
  });

  it("E6: scrolling loads newly visible days", async () => {
    const { api, store, canvas } = setup();
    await ready(canvas, store);
    fireEvent.wheel(canvas, { deltaX: 2000 });
    await waitFor(() => expect(api.loadDiary).toHaveBeenCalledWith("2026-11-13"));
  });

  it("E7: pan mode drags the scroll instead of drawing", async () => {
    const { api, store, canvas } = setup({ mode: "pan" });
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 500, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 10 });
    expect(scrollX(canvas)).toBe(100);
    fireEvent.pointerUp(canvas, {});
    fireEvent.pointerMove(canvas, { clientX: 0, clientY: 10 });
    expect(scrollX(canvas)).toBe(100);
    expect(api.saveDiary).not.toHaveBeenCalled();
  });

  it("E8: resizing keeps the center of the view", async () => {
    const { store, canvas, rerender } = setup({ focusDate: "2026-11-14" });
    await ready(canvas, store, "2026-11-14");
    expect(scrollX(canvas)).toBe(1000);
    rerender({ width: 500 });
    expect(scrollX(canvas)).toBe(1250);
  });

  it("E9: changing the focus date scrolls to it", async () => {
    const { store, canvas, rerender } = setup();
    await ready(canvas, store);
    rerender({ focusDate: "2026-11-13" });
    await waitFor(() => expect(scrollX(canvas)).toBe(2000));
  });

  it("E10: pointer move/up without an active gesture do nothing", async () => {
    const { api, store, canvas } = setup();
    await ready(canvas, store);
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, {});
    fireEvent.pointerCancel(canvas, {});
    expect(api.saveDiary).not.toHaveBeenCalled();
    expect(scrollX(canvas)).toBe(0);
  });

  it("E11: pointercancel discards the stroke being drawn", async () => {
    const { api, store, canvas } = setup();
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pressure: 0.5 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 10, pressure: 0.5 });
    fireEvent.pointerCancel(canvas, {});
    fireEvent.pointerUp(canvas, {});
    expect(api.saveDiary).not.toHaveBeenCalled();
  });

  it("E12: while drawing, saved strokes are not re-rendered dab by dab", async () => {
    const { api, store, canvas } = setup();
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pressure: 0.5 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 40, pressure: 0.5 });
    fireEvent.pointerUp(canvas, {});
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalled());

    const ctx = ctxOf(canvas);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 200, pressure: 0.5 });
    ctx.calls.length = 0;
    fireEvent.pointerMove(canvas, { clientX: 12, clientY: 202, pressure: 0.5 });
    // 1本目は画像として1回だけ貼られ、描きかけの2本目 (ごく短い) だけが円で描かれる
    expect(callsOf(ctx, "drawImage")).toHaveLength(1);
    expect(callsOf(ctx, "arc").length).toBeLessThan(100);
  });

});

const frog: Stamp = { id: "f1", assetId: "frog-run", x: 200, y: 150, scale: 1, rotation: 0, flipX: false };
const withStamps = (stamps: Stamp[]) => ({
  "2026-11-15": { date: "2026-11-15", text: "", canvas: { version: 2, strokes: [], stamps } },
});
const lastCanvas = (api: { saveDiary: { mock: { lastCall?: unknown[] } } }) =>
  (api.saveDiary.mock.lastCall![0] as DiaryEntry).canvas as { stamps: Stamp[]; strokes: unknown[] };

describe("EmakiCanvas stamps (A7)", () => {
  it("E13: dropAsset places a stamp on the day under the point and selects it", async () => {
    const { api, store, canvas, ref } = setup({ mode: "select" });
    await ready(canvas, store);
    let ok = false;
    act(() => {
      ok = ref.current!.dropAsset("rabbit-run", 300, 120);
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalled());
    expect(lastCanvas(api).stamps[0]).toMatchObject({ assetId: "rabbit-run", x: 300, y: 120, scale: 1, rotation: 0, flipX: false });
    expect(callsOf(ctxOf(canvas), "setLineDash").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "反転" })).toBeInTheDocument();
  });

  it("E14: dropAsset refuses points outside the canvas, outside the content or on days not drawable", async () => {
    const { api, store, canvas, ref } = setup({ width: 1500 }, {
      "2026-11-14": { date: "2026-11-14", text: "", canvas: "broken" },
    });
    await ready(canvas, store);
    await waitFor(() => expect(store.getSnapshot().days["2026-11-14"]?.status).toBe("canvasError"));
    expect(ref.current!.dropAsset("frog-run", -5, 100)).toBe(false);
    expect(ref.current!.dropAsset("frog-run", 100, 500)).toBe(false);
    expect(ref.current!.dropAsset("frog-run", 1200, 100)).toBe(false);
    expect(api.saveDiary).not.toHaveBeenCalled();
  });

  it("E14: dropAsset refuses points beyond the end of the scroll", async () => {
    const api = {
      listDiaryDates: vi.fn(async () => []),
      loadDiary: vi.fn(async () => null),
      saveDiary: vi.fn(async (e: DiaryEntry) => e),
    };
    const store = new EmakiStore(api, "2026-11-15");
    const ref = createRef<EmakiCanvasHandle>();
    render(
      <EmakiCanvas ref={ref} store={store} width={1500} height={400} dayWidth={1000} mode="select" brush={brush} focusDate="2026-11-15" />,
    );
    await ready(screen.getByTestId("emaki-canvas") as HTMLCanvasElement, store);
    expect(ref.current!.dropAsset("frog-run", 1200, 100)).toBe(false);
  });

  it("E15: placeAssetAtCenter puts the stamp at the center of the view", async () => {
    const { api, store, canvas, ref } = setup();
    await ready(canvas, store);
    act(() => {
      ref.current!.placeAssetAtCenter("laptop");
    });
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalled());
    expect(lastCanvas(api).stamps[0]).toMatchObject({ assetId: "laptop", x: 500, y: 200 });
  });

  it("E16: select mode selects a stamp on press and deselects on empty space", async () => {
    const { store, canvas } = setup({ mode: "select" }, withStamps([frog]));
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 210, clientY: 160 });
    fireEvent.pointerUp(canvas, { clientX: 210, clientY: 160 });
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
    fireEvent.pointerDown(canvas, { clientX: 700, clientY: 300 });
    fireEvent.pointerUp(canvas, { clientX: 700, clientY: 300 });
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("E17: dragging a stamp moves it and saves once on release", async () => {
    const { api, store, canvas } = setup({ mode: "select" }, withStamps([frog]));
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 210, clientY: 160 });
    fireEvent.pointerMove(canvas, { clientX: 250, clientY: 170 });
    fireEvent.pointerMove(canvas, { clientX: 260, clientY: 180 });
    expect(api.saveDiary).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, { clientX: 260, clientY: 180 });
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalledTimes(1));
    expect(lastCanvas(api).stamps[0]).toMatchObject({ x: 250, y: 170 });
  });

  it("E18: the corner handle resizes and the top handle rotates (Shift snaps)", async () => {
    const { api, store, canvas } = setup({ mode: "select" }, withStamps([frog]));
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 150 });
    // 右下の角 (260, 210) を (320, 270) へ → 2倍
    fireEvent.pointerDown(canvas, { clientX: 260, clientY: 210 });
    fireEvent.pointerMove(canvas, { clientX: 320, clientY: 270 });
    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 270 });
    await waitFor(() => expect(lastCanvas(api).stamps[0].scale).toBeCloseTo(2));
    // 回転つまみ: 上辺 (y=150-120) のさらに 28px 上
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 150 - 120 - 28 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 140, shiftKey: true });
    fireEvent.pointerUp(canvas, { clientX: 300, clientY: 140 });
    await waitFor(() => expect(lastCanvas(api).stamps[0].rotation).toBeCloseTo(Math.PI / 2));
  });

  it("E19: flip / delete buttons, the Delete key and Escape act on the selection", async () => {
    const other = { ...frog, id: "f2", x: 600 };
    const { api, store, canvas } = setup({ mode: "select" }, withStamps([frog, other]));
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 150 });
    fireEvent.click(screen.getByRole("button", { name: "反転" }));
    await waitFor(() => expect(lastCanvas(api).stamps[0].flipX).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => expect(lastCanvas(api).stamps.map((x) => x.id)).toEqual(["f2"]));

    fireEvent.pointerDown(canvas, { clientX: 600, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 600, clientY: 150 });
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
    fireEvent.keyDown(canvas, { key: "Delete" });
    fireEvent.pointerDown(canvas, { clientX: 600, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 600, clientY: 150 });
    fireEvent.keyDown(canvas, { key: "a" });
    fireEvent.keyDown(canvas, { key: "Delete" });
    await waitFor(() => expect(lastCanvas(api).stamps).toEqual([]));
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("E20: pointercancel during a drag and a press without moving do not save", async () => {
    const { api, store, canvas } = setup({ mode: "select" }, withStamps([frog]));
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 210, clientY: 160 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 160 });
    fireEvent.pointerCancel(canvas, {});
    fireEvent.pointerDown(canvas, { clientX: 210, clientY: 160 });
    fireEvent.pointerUp(canvas, { clientX: 210, clientY: 160 });
    expect(api.saveDiary).not.toHaveBeenCalled();
  });

  it("E21: brush mode draws over a stamp instead of selecting it", async () => {
    const { api, store, canvas } = setup({}, withStamps([frog]));
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 150, pressure: 0.5 });
    fireEvent.pointerMove(canvas, { clientX: 230, clientY: 150, pressure: 0.5 });
    fireEvent.pointerUp(canvas, {});
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalled());
    expect(lastCanvas(api).strokes).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("E22: the selection is hidden outside select mode", async () => {
    const { store, canvas, rerender } = setup({ mode: "select" }, withStamps([frog]));
    await ready(canvas, store);
    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 150 });
    rerender({ mode: "brush" });
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("E23: select mode ignores days that are not drawable", async () => {
    const { store, canvas } = setup({ mode: "select", width: 1500 }, {
      "2026-11-14": { date: "2026-11-14", text: "", canvas: "broken" },
    });
    await ready(canvas, store);
    await waitFor(() => expect(store.getSnapshot().days["2026-11-14"]?.status).toBe("canvasError"));
    fireEvent.pointerDown(canvas, { clientX: 1200, clientY: 100 });
    fireEvent.pointerUp(canvas, { clientX: 1200, clientY: 100 });
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("E24 (U12): revealDate scrolls to a day off-screen and leaves visible days alone", async () => {
    const { store, canvas, ref } = setup();
    await ready(canvas, store);
    expect(scrollX(canvas)).toBe(0);
    act(() => ref.current!.revealDate("2026-11-15"));
    expect(scrollX(canvas)).toBe(0);
    act(() => ref.current!.revealDate("2026-11-13"));
    expect(scrollX(canvas)).toBe(2000);
    act(() => ref.current!.revealDate("2000-01-01"));
    expect(scrollX(canvas)).toBe(2000);
  });

  it("E25 (F-K6): placeText puts a custom-text bubble at the center and selects it", async () => {
    const { api, store, canvas, ref } = setup({ mode: "select" });
    await ready(canvas, store);
    let ok = false;
    act(() => {
      ok = ref.current!.placeText("美酒を飲まん。");
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(api.saveDiary).toHaveBeenCalled());
    expect(lastCanvas(api).stamps[0]).toMatchObject({ assetId: "phrase-custom", text: "美酒を飲まん。", x: 500, y: 200 });
    expect(screen.getByRole("button", { name: "反転" })).toBeInTheDocument();
  });

  it("E26 (I5): redraws when the user asset version changes", async () => {
    let version = 0;
    const listeners = new Set<() => void>();
    const userAssets = {
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      getSnapshot: () => ({ version }),
    };
    const { store, canvas } = setup({ userAssets });
    await ready(canvas, store);
    const clears = () => callsOf(ctxOf(canvas), "clearRect").length;
    const before = clears();
    act(() => {
      version = 1;
      listeners.forEach((l) => l());
    });
    expect(clears()).toBeGreaterThan(before);
  });
});
