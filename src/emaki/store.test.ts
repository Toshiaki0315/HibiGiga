import { describe, expect, it, vi } from "vitest";
import type { DiaryEntry } from "../api/diary";
import { EmakiStore, HISTORY_LIMIT, type DiaryApi } from "./store";
import type { CanvasData, Stamp } from "./canvasData";
import type { Stroke } from "./stroke";

const TODAY = "2026-11-15";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeApi(db: Record<string, DiaryEntry> = {}, dates = Object.keys(db)) {
  const api = {
    listDiaryDates: vi.fn(async () => dates),
    loadDiary: vi.fn(async (d: string): Promise<DiaryEntry | null> => db[d] ?? null),
    saveDiary: vi.fn(async (e: DiaryEntry): Promise<DiaryEntry> => ({ ...e, updatedAt: "2026-11-15T21:00:00+09:00" })),
  } satisfies DiaryApi;
  return api;
}

const stroke = (id: string): Stroke => ({
  id,
  seed: 1,
  color: "#000",
  size: 10,
  bleed: 0,
  dryness: 0,
  points: [{ x: 1, y: 1, p: 0.5, t: 0 }],
});

async function readyStore(db: Record<string, DiaryEntry> = {}) {
  const api = fakeApi(db);
  const store = new EmakiStore(api, TODAY);
  await store.init();
  await store.ensureLoaded([TODAY, ...Object.keys(db)]);
  return { api, store };
}

describe("init (C7)", () => {
  it("merges saved dates with today, sorted", async () => {
    const api = fakeApi({}, ["2026-11-20", "2026-11-01"]);
    const store = new EmakiStore(api, TODAY);
    expect(store.getSnapshot().ready).toBe(false);
    await store.init();
    expect(store.getSnapshot()).toMatchObject({
      ready: true,
      dates: ["2026-11-01", TODAY, "2026-11-20"],
    });
    expect(api.listDiaryDates).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate today", async () => {
    const store = new EmakiStore(fakeApi({}, [TODAY]), TODAY);
    await store.init();
    expect(store.getSnapshot().dates).toEqual([TODAY]);
  });

  it("falls back to today only and reports the error when listing fails", async () => {
    const api = fakeApi();
    api.listDiaryDates.mockRejectedValueOnce(new Error("io down"));
    const store = new EmakiStore(api, TODAY);
    await store.init();
    expect(store.getSnapshot()).toMatchObject({ ready: true, dates: [TODAY], error: "io down" });
  });
});

describe("ensureLoaded (C7)", () => {
  it("loads only the requested dates and marks them loading first", async () => {
    const api = fakeApi({ "2026-11-14": { date: "2026-11-14", text: "a" } });
    const store = new EmakiStore(api, TODAY);
    const p = store.ensureLoaded(["2026-11-14"]);
    expect(store.getSnapshot().days["2026-11-14"]).toEqual({ status: "loading" });
    await p;
    expect(api.loadDiary).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().days["2026-11-14"]).toMatchObject({ status: "ready", text: "a" });
    expect(store.getSnapshot().days[TODAY]).toBeUndefined();
  });

  it("does not reload cached days and dedupes concurrent requests", async () => {
    const api = fakeApi();
    const store = new EmakiStore(api, TODAY);
    await Promise.all([store.ensureLoaded([TODAY]), store.ensureLoaded([TODAY, TODAY])]);
    await store.ensureLoaded([TODAY]);
    expect(api.loadDiary).toHaveBeenCalledTimes(1);
  });

  it("marks only the failing day as error and allows retry", async () => {
    const api = fakeApi();
    api.loadDiary.mockImplementation(async (d) => {
      if (d === TODAY) throw new Error("broken");
      return null;
    });
    const store = new EmakiStore(api, TODAY);
    await store.ensureLoaded([TODAY, "2026-11-14"]);
    expect(store.getSnapshot().days[TODAY]).toEqual({ status: "error", message: "broken" });
    expect(store.getSnapshot().days["2026-11-14"]).toMatchObject({ status: "ready" });

    api.loadDiary.mockResolvedValue(null);
    await store.ensureLoaded([TODAY]);
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ status: "ready" });
  });

  it("treats a missing diary as an empty ready day", async () => {
    const { store } = await readyStore();
    expect(store.getSnapshot().days[TODAY]).toEqual({
      status: "ready",
      text: "",
      canvas: { version: 2, stamps: [], strokes: [] },
    });
  });

  it("keeps text readable but disables drawing when the canvas is invalid", async () => {
    const bad = { version: 99 };
    const { store } = await readyStore({ [TODAY]: { date: TODAY, text: "読める", canvas: bad } });
    expect(store.getSnapshot().days[TODAY]).toMatchObject({
      status: "canvasError",
      text: "読める",
      rawCanvas: bad,
    });
  });
});

describe("addStroke (C7)", () => {
  it("updates locally at once and saves the merged entry", async () => {
    const { api, store } = await readyStore({ [TODAY]: { date: TODAY, text: "本文" } });
    const p = store.addStroke(TODAY, stroke("a"));
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ canvas: { strokes: [stroke("a")] } });
    await p;
    expect(api.saveDiary).toHaveBeenCalledWith({
      date: TODAY,
      text: "本文",
      canvas: { version: 2, stamps: [], strokes: [stroke("a")] },
    });
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ updatedAt: "2026-11-15T21:00:00+09:00" });
  });

  it("serializes saves per date so the last save has every stroke", async () => {
    const { api, store } = await readyStore();
    const first = deferred<DiaryEntry>();
    api.saveDiary.mockImplementationOnce(() => first.promise);
    const p1 = store.addStroke(TODAY, stroke("a"));
    const p2 = store.addStroke(TODAY, stroke("b"));
    await Promise.resolve();
    expect(api.saveDiary).toHaveBeenCalledTimes(1);
    first.resolve({ date: TODAY, text: "" });
    await Promise.all([p1, p2]);
    expect(api.saveDiary).toHaveBeenCalledTimes(2);
    expect(api.saveDiary.mock.calls[1][0].canvas).toEqual({
      version: 2,
      stamps: [],
      strokes: [stroke("a"), stroke("b")],
    });
  });

  it("keeps the stroke and reports saveError on failure, cleared by the next success", async () => {
    const { api, store } = await readyStore();
    api.saveDiary.mockRejectedValueOnce(new Error("disk full"));
    await store.addStroke(TODAY, stroke("a"));
    expect(store.getSnapshot().days[TODAY]).toMatchObject({
      saveError: "disk full",
      canvas: { strokes: [stroke("a")] },
    });
    await store.addStroke(TODAY, stroke("b"));
    expect(store.getSnapshot().days[TODAY]).not.toHaveProperty("saveError");
  });

  it("refuses days that are not ready", async () => {
    const { api, store } = await readyStore({ [TODAY]: { date: TODAY, text: "", canvas: 1 } });
    await expect(store.addStroke(TODAY, stroke("a"))).rejects.toThrow(/not drawable/);
    await expect(store.addStroke("2026-01-01", stroke("a"))).rejects.toThrow(/not drawable/);
    expect(api.saveDiary).not.toHaveBeenCalled();
  });
});

describe("saveText (C7)", () => {
  it("saves the text together with the current strokes", async () => {
    const { api, store } = await readyStore();
    await store.addStroke(TODAY, stroke("a"));
    await store.saveText(TODAY, "晩酌");
    expect(api.saveDiary).toHaveBeenLastCalledWith({
      date: TODAY,
      text: "晩酌",
      canvas: { version: 2, stamps: [], strokes: [stroke("a")] },
    });
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ text: "晩酌" });
  });

  it("preserves the raw canvas unchanged when it could not be parsed", async () => {
    const raw = { version: 99, secret: [1, 2] };
    const { api, store } = await readyStore({ [TODAY]: { date: TODAY, text: "", canvas: raw } });
    await store.saveText(TODAY, "新");
    expect(api.saveDiary).toHaveBeenCalledWith({ date: TODAY, text: "新", canvas: raw });
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ status: "canvasError", text: "新" });
  });

  it("rejects when saving fails (so the editor can show it) and records saveError", async () => {
    const { api, store } = await readyStore();
    api.saveDiary.mockRejectedValueOnce(new Error("disk full"));
    await expect(store.saveText(TODAY, "x")).rejects.toThrow("disk full");
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ saveError: "disk full" });
  });

  it("refuses days that are not loaded", async () => {
    const { store } = await readyStore();
    await expect(store.saveText("2026-01-01", "x")).rejects.toThrow(/not loaded/);
  });
});

describe("addDate / subscribe (C7)", () => {
  it("addDate inserts a valid date once, keeping order", async () => {
    const { store } = await readyStore();
    store.addDate("2026-11-01");
    store.addDate("2026-11-01");
    store.addDate("bad");
    expect(store.getSnapshot().dates).toEqual(["2026-11-01", TODAY]);
  });

  it("notifies subscribers on change and stops after unsubscribe", async () => {
    const { store } = await readyStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.addDate("2026-11-01");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.addDate("2026-11-02");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns the same snapshot object while nothing changes", async () => {
    const { store } = await readyStore();
    const a = store.getSnapshot();
    store.addDate(TODAY);
    expect(store.getSnapshot()).toBe(a);
  });
});

const stamp = (id: string, o: Partial<Stamp> = {}): Stamp => ({
  id,
  assetId: "frog-run",
  x: 100,
  y: 100,
  scale: 1,
  rotation: 0,
  flipX: false,
  ...o,
});

describe("stamps (A5)", () => {
  it("addStamp updates locally at once and saves with existing strokes", async () => {
    const { api, store } = await readyStore();
    await store.addStroke(TODAY, stroke("a"));
    const p = store.addStamp(TODAY, stamp("s1"));
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ canvas: { stamps: [stamp("s1")] } });
    await p;
    expect(api.saveDiary).toHaveBeenLastCalledWith({
      date: TODAY,
      text: "",
      canvas: { version: 2, strokes: [stroke("a")], stamps: [stamp("s1")] },
    });
  });

  it("updateStamp merges the patch into that stamp only", async () => {
    const { api, store } = await readyStore();
    await store.addStamp(TODAY, stamp("s1"));
    await store.addStamp(TODAY, stamp("s2"));
    await store.updateStamp(TODAY, "s2", { x: 5, rotation: 1, flipX: true });
    const day = store.getSnapshot().days[TODAY];
    expect(day).toMatchObject({
      canvas: { stamps: [stamp("s1"), stamp("s2", { x: 5, rotation: 1, flipX: true })] },
    });
    expect(api.saveDiary).toHaveBeenCalledTimes(3);
  });

  it("removeStamp deletes that stamp and saves", async () => {
    const { api, store } = await readyStore();
    await store.addStamp(TODAY, stamp("s1"));
    await store.addStamp(TODAY, stamp("s2"));
    await store.removeStamp(TODAY, "s1");
    expect(api.saveDiary.mock.lastCall![0].canvas).toMatchObject({ stamps: [stamp("s2")] });
  });

  it("refuses days that are not drawable and unknown stamp ids", async () => {
    const { api, store } = await readyStore();
    await expect(store.addStamp("2026-01-01", stamp("x"))).rejects.toThrow(/not drawable/);
    await expect(store.updateStamp("2026-01-01", "x", {})).rejects.toThrow(/not drawable/);
    await expect(store.removeStamp(TODAY, "nope")).rejects.toThrow(/no stamp/);
    await expect(store.updateStamp(TODAY, "nope", { x: 1 })).rejects.toThrow(/no stamp/);
    expect(api.saveDiary).not.toHaveBeenCalled();
  });

  it("records saveError on failure but keeps the stamp", async () => {
    const { api, store } = await readyStore();
    api.saveDiary.mockRejectedValueOnce(new Error("disk full"));
    await store.addStamp(TODAY, stamp("s1"));
    expect(store.getSnapshot().days[TODAY]).toMatchObject({
      saveError: "disk full",
      canvas: { stamps: [stamp("s1")] },
    });
  });
});

describe("undo / redo (U1-U11)", () => {
  const strokesOf = (store: EmakiStore, date = TODAY) => {
    const d = store.getSnapshot().days[date];
    return d?.status === "ready" ? d.canvas.strokes.map((s) => s.id) : null;
  };
  const stampsOf = (store: EmakiStore, date = TODAY) => {
    const d = store.getSnapshot().days[date];
    return d?.status === "ready" ? d.canvas.stamps : null;
  };

  it("U1: undo restores the canvas before the last edit and saves it", async () => {
    const { api, store } = await readyStore();
    expect(store.getSnapshot().history).toEqual({ canUndo: false, canRedo: false });
    await store.addStroke(TODAY, stroke("a"));
    expect(store.getSnapshot().history).toEqual({ canUndo: true, canRedo: false, undoDate: TODAY });
    await store.undo();
    expect(strokesOf(store)).toEqual([]);
    expect(api.saveDiary.mock.lastCall![0].canvas).toEqual({ version: 2, strokes: [], stamps: [] });
    expect(store.getSnapshot().history).toEqual({ canUndo: false, canRedo: true, redoDate: TODAY });
  });

  it("U2: redo re-applies the undone edit", async () => {
    const { api, store } = await readyStore();
    await store.addStroke(TODAY, stroke("a"));
    await store.undo();
    await store.redo();
    expect(strokesOf(store)).toEqual(["a"]);
    expect((api.saveDiary.mock.lastCall![0].canvas as CanvasData).strokes).toHaveLength(1);
    expect(store.getSnapshot().history).toMatchObject({ canUndo: true, canRedo: false });
  });

  it("U3: a new edit after undo clears the redo history", async () => {
    const { store } = await readyStore();
    await store.addStroke(TODAY, stroke("a"));
    await store.undo();
    await store.addStroke(TODAY, stroke("b"));
    expect(store.getSnapshot().history.canRedo).toBe(false);
    await store.redo();
    expect(strokesOf(store)).toEqual(["b"]);
  });

  it("U4: every stamp edit can be undone, and an undone removal keeps the stacking order", async () => {
    const { store } = await readyStore();
    await store.addStamp(TODAY, stamp("s1"));
    await store.addStamp(TODAY, stamp("s2"));
    await store.updateStamp(TODAY, "s1", { x: 300, scale: 2, rotation: 1 });
    await store.updateStamp(TODAY, "s1", { flipX: true });
    await store.removeStamp(TODAY, "s1");
    expect(stampsOf(store)!.map((s) => s.id)).toEqual(["s2"]);
    await store.undo();
    expect(stampsOf(store)!.map((s) => s.id)).toEqual(["s1", "s2"]);
    await store.undo();
    expect(stampsOf(store)![0].flipX).toBe(false);
    await store.undo();
    expect(stampsOf(store)![0]).toEqual(stamp("s1"));
    await store.undo();
    await store.undo();
    expect(stampsOf(store)).toEqual([]);
  });

  it("U5: history spans days and undoes the newest edit first", async () => {
    const other = "2026-11-14";
    const { store } = await readyStore({ [other]: { date: other, text: "" } });
    await store.addStroke(TODAY, stroke("a"));
    await store.addStroke(other, stroke("b"));
    expect(store.getSnapshot().history.undoDate).toBe(other);
    await store.undo();
    expect(strokesOf(store, other)).toEqual([]);
    expect(strokesOf(store)).toEqual(["a"]);
    expect(store.getSnapshot().history).toMatchObject({ undoDate: TODAY, redoDate: other });
  });

  it("U6: keeps at most HISTORY_LIMIT steps, dropping the oldest", async () => {
    const { store } = await readyStore();
    for (let i = 0; i <= HISTORY_LIMIT; i++) await store.addStroke(TODAY, stroke(`s${i}`));
    for (let i = 0; i < HISTORY_LIMIT; i++) await store.undo();
    expect(store.getSnapshot().history.canUndo).toBe(false);
    expect(strokesOf(store)).toEqual(["s0"]);
  });

  it("U7: undo / redo with an empty history do nothing", async () => {
    const { api, store } = await readyStore();
    const before = store.getSnapshot();
    await store.undo();
    await store.redo();
    expect(api.saveDiary).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
  });

  it("U8: saving the text is not recorded", async () => {
    const { store } = await readyStore();
    await store.saveText(TODAY, "本文");
    expect(store.getSnapshot().history.canUndo).toBe(false);
  });

  it("U9: the last save after an undo matches the screen even if a save was in flight", async () => {
    const { api, store } = await readyStore();
    const first = deferred<DiaryEntry>();
    api.saveDiary.mockImplementationOnce(() => first.promise);
    const p1 = store.addStroke(TODAY, stroke("a"));
    const p2 = store.undo();
    first.resolve({ date: TODAY, text: "" });
    await Promise.all([p1, p2]);
    expect((api.saveDiary.mock.lastCall![0].canvas as CanvasData).strokes).toEqual([]);
    expect(strokesOf(store)).toEqual([]);
  });

  it("U10: a failed save during undo is reported but the history still moves", async () => {
    const { api, store } = await readyStore();
    await store.addStroke(TODAY, stroke("a"));
    api.saveDiary.mockRejectedValueOnce(new Error("disk full"));
    await store.undo();
    expect(store.getSnapshot().days[TODAY]).toMatchObject({ saveError: "disk full" });
    expect(store.getSnapshot().history).toMatchObject({ canUndo: false, canRedo: true });
  });

  it("U11: subscribers are notified when the history changes", async () => {
    const { store } = await readyStore();
    await store.addStroke(TODAY, stroke("a"));
    const listener = vi.fn();
    store.subscribe(listener);
    await store.undo();
    expect(listener).toHaveBeenCalled();
  });
});
