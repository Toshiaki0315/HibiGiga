import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import App from "./App";
import { LIBRARY_OPEN_KEY, LIBRARY_WIDTH } from "./ui";

type Entry = { date: string; text: string; canvas?: unknown; updatedAt?: string };

/** メモリ上の日記ストアで Tauri コマンドを模擬する */
function setupBackend(
  db: Record<string, Entry> = {},
  fail?: { cmd: string; error: unknown },
  stamps: unknown[] = [],
) {
  const spy = vi.fn();
  mockIPC((cmd, args) => {
    spy(cmd, args);
    if (fail?.cmd === cmd) throw fail.error;
    const a = args as Record<string, any>;
    if (cmd === "list_diary_dates") return Object.keys(db).sort();
    if (cmd === "convert_kofu") return `古風:${a.text}`;
    if (cmd === "list_stamps") return stamps;
    if (cmd === "load_stamp_image") return "iVBOR";
    if (cmd === "load_diary") return db[a.date] ?? null;
    if (cmd === "save_diary") {
      const saved = { ...a.entry, updatedAt: "2026-11-15T21:00:00+09:00" };
      db[saved.date] = saved;
      return saved;
    }
    return null;
  });
  return spy;
}

const textarea = () => screen.getByLabelText("日記") as HTMLTextAreaElement;
const dateInput = () => screen.getByLabelText("日付") as HTMLInputElement;
const canvas = () => screen.getByTestId("emaki-canvas") as HTMLCanvasElement;
const saveCalls = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.filter(([cmd]) => cmd === "save_diary").map(([, a]) => a.entry);

describe("App", () => {
  it("A1: loads the diary for the initial date into the editor", async () => {
    const spy = setupBackend({ "2026-11-15": { date: "2026-11-15", text: "晩酌した", updatedAt: "x" } });
    render(<App initialDate="2026-11-15" />);
    await waitFor(() => expect(textarea().value).toBe("晩酌した"));
    expect(dateInput().value).toBe("2026-11-15");
    expect(spy).toHaveBeenCalledWith("list_diary_dates", {});
    expect(screen.queryByText("まだ記されておらぬ")).not.toBeInTheDocument();
  });

  it("A2: shows an empty editor when the day has never been saved", async () => {
    setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    expect(textarea().value).toBe("");
  });

  it("A3: saves the text together with strokes drawn on the scroll", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.pointerDown(canvas(), { clientX: 30, clientY: 30, pressure: 0.5 });
    fireEvent.pointerMove(canvas(), { clientX: 80, clientY: 40, pressure: 0.5 });
    fireEvent.pointerUp(canvas(), {});
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(1));

    fireEvent.change(textarea(), { target: { value: "今日も仕事が忙しかった" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(2));
    await screen.findByText("保存いたした");
    const last = saveCalls(spy).at(-1);
    expect(last.text).toBe("今日も仕事が忙しかった");
    expect(last.canvas.strokes).toHaveLength(1);
  });

  it("A4: shows the error message when saving fails", async () => {
    setupBackend({}, { cmd: "save_diary", error: { kind: "io", message: "disk full" } });
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("A5: changing the date loads that day and scrolls the emaki to it", async () => {
    const spy = setupBackend({ "2026-11-14": { date: "2026-11-14", text: "昨日の記" } });
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.change(dateInput(), { target: { value: "2026-11-01" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("load_diary", { date: "2026-11-01" }));
    fireEvent.change(dateInput(), { target: { value: "2026-11-14" } });
    await waitFor(() => expect(textarea().value).toBe("昨日の記"));
  });

  it("A5: ignores clearing the date input", async () => {
    setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.change(dateInput(), { target: { value: "" } });
    expect(dateInput().value).toBe("2026-11-15");
  });

  it("A6: shows the error message when loading fails", async () => {
    setupBackend({}, { cmd: "load_diary", error: { kind: "corrupted", message: "broken file" } });
    render(<App initialDate="2026-11-15" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("broken file");
  });

  it("A6: warns about a broken canvas but keeps the text editable", async () => {
    setupBackend({ "2026-11-15": { date: "2026-11-15", text: "本文", canvas: { version: 9 } } });
    render(<App initialDate="2026-11-15" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("絵");
    expect(textarea().value).toBe("本文");
  });

  it("A7: defaults to today's date when no initialDate is given", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 15, 9, 0));
    const spy = setupBackend();
    render(<App />);
    vi.useRealTimers();
    await screen.findByText("まだ記されておらぬ");
    expect(spy).toHaveBeenCalledWith("load_diary", { date: "2026-11-15" });
  });

  it("A8: keeps the unsaved draft when a stroke is saved", async () => {
    setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.change(textarea(), { target: { value: "書きかけ" } });
    fireEvent.pointerDown(canvas(), { clientX: 30, clientY: 30, pressure: 0.5 });
    fireEvent.pointerUp(canvas(), {});
    await screen.findByText("保存いたした");
    expect(textarea().value).toBe("書きかけ");
  });

  it("A9: the toolbar switches mode and brush settings", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    const pan = screen.getByRole("button", { name: "移動" });
    fireEvent.click(pan);
    expect(pan).toHaveAttribute("aria-pressed", "true");
    expect(canvas()).toHaveClass("mode-pan");
    fireEvent.click(screen.getByRole("button", { name: "筆" }));
    expect(canvas()).toHaveClass("mode-brush");

    fireEvent.change(screen.getByLabelText("太さ"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("にじみ"), { target: { value: "0.8" } });
    fireEvent.change(screen.getByLabelText("かすれ"), { target: { value: "0.1" } });
    fireEvent.pointerDown(canvas(), { clientX: 30, clientY: 30, pressure: 0.5 });
    fireEvent.pointerUp(canvas(), {});
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(1));
    expect(saveCalls(spy)[0].canvas.strokes[0]).toMatchObject({ size: 30, bleed: 0.8, dryness: 0.1 });
  });

  it("A10: shows a save error from the store (e.g. a failed stroke save)", async () => {
    setupBackend({}, { cmd: "save_diary", error: { kind: "io", message: "disk full" } });
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.pointerDown(canvas(), { clientX: 30, clientY: 30, pressure: 0.5 });
    fireEvent.pointerUp(canvas(), {});
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });

  it("A11: the canvas follows the window width", async () => {
    setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    act(() => {
      window.innerWidth = 640;
      window.dispatchEvent(new Event("resize"));
    });
    expect(canvas().style.width).toBe(`${640 - LIBRARY_WIDTH}px`);
  });

  it("A12: reports a failure to list saved dates", async () => {
    setupBackend({}, { cmd: "list_diary_dates", error: { kind: "io", message: "no access" } });
    render(<App initialDate="2026-11-15" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("no access");
  });

  it("A13: tapping a library item places it at the center and switches to select mode", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    expect(screen.getByRole("button", { name: "選択" })).toBeInTheDocument();
    const frog = screen.getByRole("button", { name: "カエル（走る）" });
    fireEvent.pointerDown(frog, { clientX: 20, clientY: 300 });
    fireEvent.pointerUp(frog, { clientX: 20, clientY: 300 });
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(1));
    expect(saveCalls(spy)[0].canvas.stamps[0]).toMatchObject({ assetId: "frog-run" });
    expect(canvas()).toHaveClass("mode-select");
    expect(screen.getByRole("button", { name: "反転" })).toBeInTheDocument();
  });

  it("A14: dragging a library item onto the scroll drops it there; elsewhere it is ignored", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.click(screen.getByRole("tab", { name: "道具" }));
    const pc = screen.getByRole("button", { name: "ノートPC" });
    fireEvent.pointerDown(pc, { clientX: 20, clientY: 300 });
    fireEvent.pointerMove(pc, { clientX: 300, clientY: 9999 });
    fireEvent.pointerUp(pc, { clientX: 300, clientY: 9999 });
    expect(canvas()).toHaveClass("mode-brush");
    expect(saveCalls(spy)).toHaveLength(0);

    fireEvent.pointerDown(pc, { clientX: 20, clientY: 300 });
    fireEvent.pointerMove(pc, { clientX: 300, clientY: 120 });
    fireEvent.pointerUp(pc, { clientX: 300, clientY: 120 });
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(1));
    expect(saveCalls(spy)[0].canvas.stamps[0]).toMatchObject({ assetId: "laptop", y: 120 });
    expect(canvas()).toHaveClass("mode-select");
  });

  it("A15: tapping an item when the center day cannot be drawn does not switch mode", async () => {
    setupBackend({}, { cmd: "load_diary", error: { kind: "io", message: "x" } });
    render(<App initialDate="2026-11-15" />);
    await screen.findByRole("alert");
    const frog = screen.getByRole("button", { name: "カエル（走る）" });
    fireEvent.pointerDown(frog, { clientX: 20, clientY: 300 });
    fireEvent.pointerUp(frog, { clientX: 20, clientY: 300 });
    expect(canvas()).toHaveClass("mode-brush");
  });

  const drawStroke = async (spy: ReturnType<typeof vi.fn>, count: number) => {
    fireEvent.pointerDown(canvas(), { clientX: 30, clientY: 30, pressure: 0.5 });
    fireEvent.pointerMove(canvas(), { clientX: 80, clientY: 40, pressure: 0.5 });
    fireEvent.pointerUp(canvas(), {});
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(count));
  };
  const undoBtn = () => screen.getByRole("button", { name: "元に戻す" });
  const redoBtn = () => screen.getByRole("button", { name: "やり直し" });
  const lastStrokes = (spy: ReturnType<typeof vi.fn>) => saveCalls(spy).at(-1).canvas.strokes.length;

  it("U13: undo / redo buttons are disabled until there is something to undo", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
    await drawStroke(spy, 1);
    expect(undoBtn()).toBeEnabled();
  });

  it("U14: the buttons undo and redo the stroke", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    await drawStroke(spy, 1);
    fireEvent.click(undoBtn());
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(2));
    expect(lastStrokes(spy)).toBe(0);
    expect(redoBtn()).toBeEnabled();
    fireEvent.click(redoBtn());
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(3));
    expect(lastStrokes(spy)).toBe(1);
  });

  it("U15: keyboard shortcuts work except while typing in a field", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    // 履歴が空のうちは何もしない
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(saveCalls(spy)).toHaveLength(0);
    await drawStroke(spy, 1);

    fireEvent.keyDown(textarea(), { key: "z", ctrlKey: true });
    fireEvent.keyDown(dateInput(), { key: "z", metaKey: true });
    fireEvent.keyDown(document.body, { key: "z" });
    expect(saveCalls(spy)).toHaveLength(1);

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(lastStrokes(spy)).toBe(0));
    fireEvent.keyDown(document.body, { key: "Z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(lastStrokes(spy)).toBe(1));
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    await waitFor(() => expect(lastStrokes(spy)).toBe(0));
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    await waitFor(() => expect(lastStrokes(spy)).toBe(1));
    expect(saveCalls(spy)).toHaveLength(5);
  });

  it("U16: undoing an edit on an off-screen day scrolls the emaki to it", async () => {
    const spy = setupBackend({ "2026-11-13": { date: "2026-11-13", text: "一昨日" } });
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    const atToday = canvas().dataset.scrollX;
    fireEvent.change(dateInput(), { target: { value: "2026-11-13" } });
    await waitFor(() => expect(textarea().value).toBe("一昨日"));
    const atOld = canvas().dataset.scrollX;
    expect(atOld).not.toBe(atToday);
    await drawStroke(spy, 1);
    expect(saveCalls(spy)[0].date).toBe("2026-11-13");

    fireEvent.change(dateInput(), { target: { value: "2026-11-15" } });
    await waitFor(() => expect(canvas().dataset.scrollX).toBe(atToday));
    fireEvent.click(undoBtn());
    await waitFor(() => expect(canvas().dataset.scrollX).toBe(atOld));
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(2));
    expect(saveCalls(spy)[1].date).toBe("2026-11-13");
  });

  it("U-K (F-K5/F-K6): converts the draft and places the result as a bubble", async () => {
    const spy = setupBackend();
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.change(textarea(), { target: { value: "今日も疲れた。" } });
    fireEvent.click(screen.getByRole("button", { name: "古風に変換" }));
    const result = (await screen.findByDisplayValue("古風:今日も疲れた。")) as HTMLTextAreaElement;
    expect(spy).toHaveBeenCalledWith("convert_kofu", { text: "今日も疲れた。" });
    fireEvent.click(screen.getByRole("button", { name: "吹き出しにして置く" }));
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(1));
    expect(saveCalls(spy)[0].canvas.stamps[0]).toMatchObject({ assetId: "phrase-custom", text: result.value });
    expect(canvas()).toHaveClass("mode-select");
  });

  it("I7: an imported stamp can be placed and is saved as user:<id>", async () => {
    const stamp = {
      id: "6a2f41a3-c54c-4ce8-a2d2-0324e1c32e22",
      name: "うちの猫",
      width: 640,
      height: 480,
      style: "ink",
      createdAt: "2026-11-15T21:00:00+09:00",
    };
    const spy = setupBackend({}, undefined, [stamp]);
    render(<App initialDate="2026-11-15" />);
    await screen.findByText("まだ記されておらぬ");
    fireEvent.click(screen.getByRole("tab", { name: "自作" }));
    const item = await screen.findByRole("button", { name: "うちの猫" });
    fireEvent.pointerDown(item, { clientX: 20, clientY: 300 });
    fireEvent.pointerUp(item, { clientX: 20, clientY: 300 });
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(1));
    expect(saveCalls(spy)[0].canvas.stamps[0]).toMatchObject({ assetId: `user:${stamp.id}` });
    expect(canvas()).toHaveClass("mode-select");
  });

  describe("library pane toggle (P1-P5)", () => {
    const toggle = () => screen.getByRole("button", { name: "素材" });
    const library = () => screen.queryByRole("complementary", { name: "素材" });

    it("P1: starts open with the canvas narrowed by the pane", async () => {
      setupBackend();
      render(<App initialDate="2026-11-15" />);
      await screen.findByText("まだ記されておらぬ");
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      expect(library()).toBeInTheDocument();
      expect(canvas().style.width).toBe(`${window.innerWidth - LIBRARY_WIDTH}px`);
    });

    it("P2: the button hides the pane and widens the canvas, and shows it again", async () => {
      setupBackend();
      render(<App initialDate="2026-11-15" />);
      await screen.findByText("まだ記されておらぬ");
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(library()).not.toBeInTheDocument();
      expect(canvas().style.width).toBe(`${window.innerWidth}px`);
      fireEvent.click(toggle());
      expect(library()).toBeInTheDocument();
      expect(canvas().style.width).toBe(`${window.innerWidth - LIBRARY_WIDTH}px`);
    });

    it("P3: remembers the closed state across restarts", async () => {
      setupBackend();
      const first = render(<App initialDate="2026-11-15" />);
      await screen.findByText("まだ記されておらぬ");
      fireEvent.click(toggle());
      first.unmount();
      render(<App initialDate="2026-11-15" />);
      await screen.findByText("まだ記されておらぬ");
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      expect(library()).not.toBeInTheDocument();
    });

    it("P4: keeps working when storage throws", async () => {
      const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      setupBackend();
      render(<App initialDate="2026-11-15" />);
      await screen.findByText("まだ記されておらぬ");
      expect(library()).toBeInTheDocument();
      fireEvent.click(toggle());
      expect(library()).not.toBeInTheDocument();
      get.mockRestore();
      set.mockRestore();
    });

    it("P5: ignores a corrupted stored value", async () => {
      localStorage.setItem(LIBRARY_OPEN_KEY, "maybe");
      setupBackend();
      render(<App initialDate="2026-11-15" />);
      await screen.findByText("まだ記されておらぬ");
      expect(library()).toBeInTheDocument();
    });
  });
});
