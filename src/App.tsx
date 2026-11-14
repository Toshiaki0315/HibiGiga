import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatDate } from "./api/diary";
import { AssetLibrary } from "./components/AssetLibrary";
import { KofuPanel } from "./components/KofuPanel";
import { EmakiCanvas, type CanvasMode, type EmakiCanvasHandle } from "./emaki/EmakiCanvas";
import { EmakiStore, defaultApi } from "./emaki/store";
import { UserAssetStore } from "./assets/userAssets";
import { setUserAssetResolver } from "./emaki/stampRender";
import type { BrushSettings } from "./emaki/stroke";
import { LIBRARY_OPEN_KEY, LIBRARY_WIDTH } from "./ui";
import "./App.css";

export interface AppProps {
  /** 初期表示する日付 (`YYYY-MM-DD`)。省略時は今日。 */
  initialDate?: string;
}

const CANVAS_HEIGHT = 420;
const MODES: [CanvasMode, string][] = [
  ["brush", "筆"],
  ["pan", "移動"],
  ["select", "選択"],
];

/** 素材ペインの開閉状態を読む (未保存・読めない・不正な値なら開いた状態) */
function readLibraryOpen(): boolean {
  try {
    return localStorage.getItem(LIBRARY_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeLibraryOpen(open: boolean): void {
  try {
    localStorage.setItem(LIBRARY_OPEN_KEY, String(open));
  } catch {
    // 保存できない環境では、今回の起動中だけ状態を保つ
  }
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export default function App({ initialDate }: AppProps) {
  const [today] = useState(() => initialDate ?? formatDate(new Date()));
  const [store] = useState(() => new EmakiStore(defaultApi, today));
  // 取り込んだスタンプ画像 (OS のアプリ用データフォルダに保存。リポジトリには入らない)
  const [userAssets] = useState(() => new UserAssetStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const width = useWindowWidth();

  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState<string | undefined>();
  const [mode, setMode] = useState<CanvasMode>("brush");
  const [brush, setBrush] = useState<BrushSettings>({ size: 14, bleed: 0.3, dryness: 0.3 });
  const canvasRef = useRef<EmakiCanvasHandle>(null);
  const [libraryOpen, setLibraryOpen] = useState(readLibraryOpen);
  const toggleLibrary = () => {
    writeLibraryOpen(!libraryOpen);
    setLibraryOpen(!libraryOpen);
  };

  const { history } = snapshot;

  /** 元に戻す／やり直し。対象の日が画面外なら絵巻をそこへ送る。 */
  const undo = () => {
    if (history.undoDate) canvasRef.current!.revealDate(history.undoDate);
    void store.undo();
  };
  const redo = () => {
    if (history.redoDate) canvasRef.current!.revealDate(history.redoDate);
    void store.redo();
  };
  const historyRef = useRef({ undo, redo });
  historyRef.current = { undo, redo };

  // ショートカット: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y (入力欄では標準の取り消しに任せる)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) historyRef.current.redo();
        else historyRef.current.undo();
      } else if (e.ctrlKey && key === "y") {
        e.preventDefault();
        historyRef.current.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** 素材を置けたら選択モードにして、すぐ動かせるようにする */
  const afterPlace = (placed: boolean) => {
    if (placed) setMode("select");
  };

  useEffect(() => {
    void store.init();
  }, [store]);

  useEffect(() => {
    setUserAssetResolver(userAssets);
    void userAssets.init();
    return () => setUserAssetResolver(null);
  }, [userAssets]);

  useEffect(() => {
    store.addDate(date);
    void store.ensureLoaded([date]);
  }, [store, date]);

  const day = snapshot.days[date];
  const editable = day !== undefined && "text" in day ? day : undefined;

  // 日付を切り替えて読み込みが終わった時だけ下書きを差し替える (保存のたびには上書きしない)
  const loaded = editable !== undefined;
  useEffect(() => {
    if (!editable) return;
    setDraft(editable.text);
    setBaseline(editable.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loaded]);

  const alerts = [
    snapshot.error,
    day?.status === "error" ? day.message : undefined,
    day?.status === "canvasError" ? `絵が損なわれておる (${day.message})` : undefined,
    editable?.saveError,
  ].filter(Boolean);
  const neverSaved = editable !== undefined && !editable.updatedAt;
  const savedNow =
    editable?.updatedAt !== undefined && editable.updatedAt !== baseline && !editable.saveError;

  function handleSave() {
    // 失敗は store の saveError として表示される
    store.saveText(date, draft).catch(() => {});
  }

  const setBrushValue = (key: keyof BrushSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBrush({ ...brush, [key]: Number(e.currentTarget.value) });

  return (
    <main className="app">
      <header className="toolbar">
        <h1>日々戯画</h1>
        <button
          type="button"
          className="library-toggle"
          aria-expanded={libraryOpen}
          aria-controls="asset-library"
          onClick={toggleLibrary}
        >
          素材
        </button>
        <div className="tool-group" role="group" aria-label="道具">
          {MODES.map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <div className="tool-group" role="group" aria-label="履歴">
          <button type="button" onClick={undo} disabled={!history.canUndo}>
            元に戻す
          </button>
          <button type="button" onClick={redo} disabled={!history.canRedo}>
            やり直し
          </button>
        </div>
        <label>
          太さ
          <input type="range" min={2} max={48} step={1} value={brush.size} onChange={setBrushValue("size")} />
        </label>
        <label>
          にじみ
          <input type="range" min={0} max={1} step={0.05} value={brush.bleed} onChange={setBrushValue("bleed")} />
        </label>
        <label>
          かすれ
          <input type="range" min={0} max={1} step={0.05} value={brush.dryness} onChange={setBrushValue("dryness")} />
        </label>
      </header>

      <div className="workspace">
        {libraryOpen && (
          <AssetLibrary
            userAssets={userAssets}
            onDrop={(id, x, y) => afterPlace(canvasRef.current!.dropAsset(id, x, y))}
            onPlace={(id) => afterPlace(canvasRef.current!.placeAssetAtCenter(id))}
          />
        )}
        <div className="stage">
          <EmakiCanvas
            ref={canvasRef}
            store={store}
            userAssets={userAssets}
            width={Math.max(width - (libraryOpen ? LIBRARY_WIDTH : 0), 0)}
            height={CANVAS_HEIGHT}
            mode={mode}
            brush={brush}
            focusDate={date}
          />

          <section className="editor">
            <div className="row">
              <label>
                日付
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (e.currentTarget.value) setDate(e.currentTarget.value);
                  }}
                />
              </label>
              <button type="button" onClick={handleSave}>
                保存する
              </button>
            </div>
            <label>
              日記
              <textarea value={draft} onChange={(e) => setDraft(e.currentTarget.value)} rows={6} />
            </label>
            <KofuPanel
              source={draft}
              onPlace={(text) => {
                const placed = canvasRef.current!.placeText(text);
                afterPlace(placed);
                return placed;
              }}
            />
            {neverSaved && <p className="status">まだ記されておらぬ</p>}
            {savedNow && <p className="status">保存いたした</p>}
            {alerts.length > 0 && (
              <p className="status error" role="alert">
                {alerts.join(" / ")}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
