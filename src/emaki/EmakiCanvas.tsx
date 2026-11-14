import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Stamp } from "./canvasData";
import { LayerCache } from "./layerCache";
import { buildLayout, locate, scrollToDate, visibleSegments } from "./layout";
import { COLORS, drawEmaki } from "./render";
import { handleAt, hitTest, moveBy, resizeTo, rotateTo, type Point } from "./stampGeometry";
import { sizeOfStamp } from "./stampRender";

/** 取り込んだスタンプのストアが無い場合 (描き直しの通知なし) */
const NO_USER_ASSETS = { subscribe: () => () => {}, getSnapshot: () => ({ version: 0 }) };

/** 自由な文の吹き出しの素材 id */
const CUSTOM_PHRASE_ID = "phrase-custom";
import type { EmakiStore } from "./store";
import { appendPoint, type BrushSettings, type Stroke } from "./stroke";
import {
  clampScroll,
  resizeViewport,
  screenToWorld,
  wheelToScroll,
  type Direction,
} from "./viewport";

export type CanvasMode = "brush" | "pan" | "select";

/** 親 (素材ライブラリ) から素材を置くための操作 */
export interface EmakiCanvasHandle {
  /** 画面座標に素材を置く。置けなければ false。 */
  dropAsset(assetId: string, clientX: number, clientY: number): boolean;
  /** 画面中央に素材を置く。置けなければ false。 */
  placeAssetAtCenter(assetId: string): boolean;
  /** 自由な文の吹き出しを画面中央に置く。置けなければ false。 */
  placeText(text: string): boolean;
  /** その日が画面外ならスクロールして映す (元に戻す時など) */
  revealDate(date: string): void;
}

export interface EmakiCanvasProps {
  store: EmakiStore;
  width: number;
  height: number;
  /** 1日分の区画の幅 (px) */
  dayWidth?: number;
  direction?: Direction;
  /** brush: ドラッグで描く / pan: ドラッグで絵巻を送る / select: スタンプを選んで変形する */
  mode: CanvasMode;
  brush: BrushSettings;
  color?: string;
  /** 画面中央に映す日付。変わるたびにそこへスクロールする。 */
  focusDate: string;
  /** 筆跡シード用の乱数 (テスト用に差し替え可) */
  random?: () => number;
  /** 時刻 (ms) の取得 (テスト用に差し替え可) */
  now?: () => number;
  ref?: React.Ref<EmakiCanvasHandle>;
  /** 取り込んだスタンプ画像のストア (画像が読み込まれたら描き直す) */
  userAssets?: { subscribe(l: () => void): () => void; getSnapshot(): { version: number } };
}

interface StampGesture {
  kind: "move" | "scale" | "rotate";
  date: string;
  segX: number;
  original: Stamp;
  start: Point;
  preview: Stamp;
}

interface Drawing {
  date: string;
  segX: number;
  startedAt: number;
  stroke: Stroke;
}

/** 前の点からこれ未満しか動いていない点は記録しない */
const MIN_POINT_DIST = 1.5;
/** マウス等、筆圧を報告しないデバイスの既定値 */
const DEFAULT_PRESSURE = 0.5;

/**
 * store の編集は「描画不可の日」等でのみ reject する。操作開始後に日の状態が変わった場合で、
 * 画面上は何もしないのが正しいため握りつぶす (保存失敗は store が saveError として表示する)。
 */
const ignoreRejection = () => {};

const pressureOf = (e: ReactPointerEvent) => (e.pressure > 0 ? e.pressure : DEFAULT_PRESSURE);

function localPoint(e: ReactPointerEvent<HTMLCanvasElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** 横に無限に伸びる絵巻のキャンバス */
export function EmakiCanvas({
  store,
  width,
  height,
  dayWidth = 1200,
  direction = "rtl",
  mode,
  brush,
  color = COLORS.sumi,
  focusDate,
  random = Math.random,
  now = Date.now,
  ref,
  userAssets = NO_USER_ASSETS,
}: EmakiCanvasProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const assetsVersion = useSyncExternalStore(userAssets.subscribe, () => userAssets.getSnapshot().version);
  const layout = useMemo(
    () => buildLayout(snapshot.dates, { dayWidth, direction }),
    [snapshot.dates, dayWidth, direction],
  );
  const contentWidth = layout.contentWidth;
  const [rawScroll, setRawScroll] = useState(0);
  const scrollX = clampScroll(rawScroll, width, contentWidth);
  const viewport = useMemo(() => ({ scrollX, width, height }), [scrollX, width, height]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layers] = useState(() => new LayerCache());
  const [drawing, setDrawingState] = useState<Drawing | null>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const panRef = useRef<number | null>(null);
  const focusedRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<{ date: string; id: string } | null>(null);
  const [gesture, setGestureState] = useState<StampGesture | null>(null);
  const gestureRef = useRef<StampGesture | null>(null);
  const prevWidthRef = useRef(width);

  const setDrawing = (d: Drawing | null) => {
    drawingRef.current = d;
    setDrawingState(d);
  };
  const setGesture = (g: StampGesture | null) => {
    gestureRef.current = g;
    setGestureState(g);
  };
  const stampsOf = (date: string): Stamp[] => {
    const day = snapshot.days[date];
    return day?.status === "ready" ? day.canvas.stamps : [];
  };
  const selectedStamp = selected ? stampsOf(selected.date).find((st) => st.id === selected.id) : undefined;
  const showSelection = mode === "select" && selectedStamp !== undefined;
  const scrollByPx = (dx: number) =>
    setRawScroll((s) => clampScroll(clampScroll(s, width, contentWidth) + dx, width, contentWidth));

  // 指定日へスクロール (レイアウトに現れた時点で一度だけ)
  useLayoutEffect(() => {
    if (focusedRef.current === focusDate) return;
    const target = scrollToDate(layout, focusDate, width);
    if (target === null) return;
    focusedRef.current = focusDate;
    setRawScroll(target);
  }, [focusDate, layout, width]);

  // リサイズ時は中央の位置を保つ
  useLayoutEffect(() => {
    const oldWidth = prevWidthRef.current;
    if (oldWidth === width) return;
    prevWidthRef.current = width;
    setRawScroll((s) => {
      const before = { scrollX: clampScroll(s, oldWidth, contentWidth), width: oldWidth, height };
      return resizeViewport(before, width, height, contentWidth).scrollX;
    });
  }, [width, height, contentWidth]);

  // 見えている日 (と前後半日分) だけ読み込む
  const visibleKey = visibleSegments(layout, viewport, dayWidth / 2)
    .map((s) => s.date)
    .join(",");
  useEffect(() => {
    if (!visibleKey) return;
    void store.ensureLoaded(visibleKey.split(","));
  }, [store, visibleKey]);

  // 素材を画面座標に置く (text は自由な文の吹き出し用)
  function dropAsset(assetId: string, clientX: number, clientY: number, text?: string): boolean {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > width || y > height) return false;
    const loc = locate(layout, screenToWorld(viewport, x));
    if (!loc || snapshot.days[loc.segment.date]?.status !== "ready") return false;
    const stamp: Stamp = {
      id: crypto.randomUUID(),
      assetId,
      x: loc.localX,
      y,
      scale: 1,
      rotation: 0,
      flipX: false,
      ...(text === undefined ? {} : { text }),
    };
    store.addStamp(loc.segment.date, stamp).catch(ignoreRejection);
    setSelected({ date: loc.segment.date, id: stamp.id });
    return true;
  }

  function placeAtCenter(assetId: string, text?: string): boolean {
    const rect = canvasRef.current!.getBoundingClientRect();
    return dropAsset(assetId, rect.left + width / 2, rect.top + height / 2, text);
  }

  useImperativeHandle(ref, () => ({
    dropAsset: (assetId: string, clientX: number, clientY: number) => dropAsset(assetId, clientX, clientY),
    placeAssetAtCenter: (assetId: string) => placeAtCenter(assetId),
    placeText: (text: string) => placeAtCenter(CUSTOM_PHRASE_ID, text),
    revealDate(date: string) {
      const seg = layout.segments.find((sg) => sg.date === date);
      if (!seg || (seg.x < scrollX + width && seg.x + seg.width > scrollX)) return;
      setRawScroll(scrollToDate(layout, date, width)!);
    },
  }));

  // 描画
  const dpr = window.devicePixelRatio;
  useEffect(() => {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEmaki(ctx, {
      layout,
      viewport,
      days: snapshot.days,
      current: drawing ? { date: drawing.date, stroke: drawing.stroke } : undefined,
      layers,
      dpr,
      floating: gesture ? { date: gesture.date, stamp: gesture.preview } : undefined,
      selection: showSelection ? { date: selected!.date, stamp: gesture?.preview ?? selectedStamp! } : undefined,
      assetsVersion,
    });
  }, [layout, viewport, snapshot.days, drawing, dpr, layers, gesture, showSelection, selected, selectedStamp, assetsVersion]);

  function startGesture(kind: StampGesture["kind"], date: string, segX: number, stamp: Stamp, p: Point) {
    setGesture({ kind, date, segX, original: stamp, start: p, preview: stamp });
  }

  /** 選択モードの押下: つまみ → スタンプ → 空き の順に判定する */
  function pressSelect(wx: number, y: number): void {
    if (selected && selectedStamp) {
      const seg = layout.segments.find((sg) => sg.date === selected.date)!;
      const p = { x: wx - seg.x, y };
      const handle = handleAt(selectedStamp, sizeOfStamp(selectedStamp), p);
      if (handle) return startGesture(handle, selected.date, seg.x, selectedStamp, p);
    }
    for (const seg of visibleSegments(layout, viewport)) {
      const p = { x: wx - seg.x, y };
      const hit = hitTest(stampsOf(seg.date), sizeOfStamp, p);
      if (hit) {
        setSelected({ date: seg.date, id: hit.id });
        return startGesture("move", seg.date, seg.x, hit, p);
      }
    }
    setSelected(null);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const { x, y } = localPoint(e);
    if (mode === "pan") {
      panRef.current = e.clientX;
    } else if (mode === "select") {
      pressSelect(screenToWorld(viewport, x), y);
    } else {
      const loc = locate(layout, screenToWorld(viewport, x));
      if (!loc || snapshot.days[loc.segment.date]?.status !== "ready") return;
      setDrawing({
        date: loc.segment.date,
        segX: loc.segment.x,
        startedAt: now(),
        stroke: {
          id: crypto.randomUUID(),
          seed: Math.floor(random() * 2 ** 32),
          color,
          ...brush,
          points: [{ x: loc.localX, y, p: pressureOf(e), t: 0 }],
        },
      });
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (panRef.current !== null) {
      scrollByPx(panRef.current - e.clientX);
      panRef.current = e.clientX;
      return;
    }
    const g = gestureRef.current;
    if (g) {
      const { x, y } = localPoint(e);
      const p = { x: screenToWorld(viewport, x) - g.segX, y };
      const preview =
        g.kind === "move"
          ? moveBy(g.original, p.x - g.start.x, p.y - g.start.y)
          : g.kind === "scale"
            ? resizeTo(g.original, sizeOfStamp(g.original), p)
            : rotateTo(g.original, p, e.shiftKey);
      setGesture({ ...g, preview });
      return;
    }
    const d = drawingRef.current;
    if (!d) return;
    const { x, y } = localPoint(e);
    const pt = { x: screenToWorld(viewport, x) - d.segX, y, p: pressureOf(e), t: now() - d.startedAt };
    setDrawing({ ...d, stroke: { ...d.stroke, points: appendPoint(d.stroke.points, pt, MIN_POINT_DIST) } });
  }

  function handlePointerUp() {
    panRef.current = null;
    const g = gestureRef.current;
    if (g) {
      setGesture(null);
      const { x, y, scale, rotation } = g.preview;
      const o = g.original;
      if (x !== o.x || y !== o.y || scale !== o.scale || rotation !== o.rotation) {
        store.updateStamp(g.date, o.id, { x, y, scale, rotation }).catch(ignoreRejection);
      }
      return;
    }
    const d = drawingRef.current;
    if (!d) return;
    setDrawing(null);
    store.addStroke(d.date, d.stroke).catch(ignoreRejection);
  }

  function handlePointerCancel() {
    panRef.current = null;
    setDrawing(null);
    setGesture(null);
  }

  function removeSelected() {
    store.removeStamp(selected!.date, selectedStamp!.id).catch(ignoreRejection);
    setSelected(null);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLCanvasElement>) {
    if (e.key === "Escape") setSelected(null);
    else if ((e.key === "Delete" || e.key === "Backspace") && showSelection) removeSelected();
  }

  function handleWheel(e: ReactWheelEvent<HTMLCanvasElement>) {
    scrollByPx(wheelToScroll(e, direction, width));
  }

  const toggleFlip = () =>
    store.updateStamp(selected!.date, selectedStamp!.id, { flipX: !selectedStamp!.flipX }).catch(ignoreRejection);

  return (
    <div className="emaki-wrap" style={{ position: "relative", width: `${width}px` }}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        data-testid="emaki-canvas"
        data-scroll-x={scrollX}
        width={Math.round(width * dpr)}
        height={Math.round(height * dpr)}
        style={{ width: `${width}px`, height: `${height}px`, touchAction: "none", display: "block" }}
        className={`emaki-canvas mode-${mode}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      />
      {showSelection && (
        <div className="stamp-actions" role="toolbar" aria-label="スタンプ">
          <button type="button" onClick={toggleFlip}>
            反転
          </button>
          <button type="button" onClick={removeSelected}>
            削除
          </button>
        </div>
      )}
    </div>
  );
}
