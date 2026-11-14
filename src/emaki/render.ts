import { renderStroke, renderVerticalText } from "./brush";
import { toKanjiDate } from "./kanji";
import type { LayerCache } from "./layerCache";
import { renderSelection, renderStamp, sizeOfStamp } from "./stampRender";
import { LABEL_MARGIN, visibleSegments, type Layout } from "./layout";
import type { DayState } from "./store";
import type { Stamp } from "./canvasData";
import type { Stroke } from "./stroke";
import { worldToScreen, type Viewport } from "./viewport";

export const COLORS = {
  washi: "#f3e9d2",
  sumi: "#1f1b16",
  line: "rgba(120, 100, 60, 0.35)",
  notice: "#b0302a",
};

const LABEL_SIZE = 28;
const LABEL_TOP = 32;

export interface DrawState {
  layout: Layout;
  viewport: Viewport;
  days: Record<string, DayState>;
  /** 描画中 (未確定) の筆跡 */
  current?: { date: string; stroke: Stroke };
  /** 保存済みの筆跡を日ごとの画像として使い回すキャッシュ */
  layers?: LayerCache;
  dpr?: number;
  /** ドラッグ中のスタンプ (画像キャッシュから外して毎フレーム描く) */
  floating?: { date: string; stamp: Stamp };
  /** 取り込んだスタンプ画像の読み込み状態の番号 (変わると日ごとの画像を描き直す) */
  assetsVersion?: number;
  /** 選択枠を描くスタンプ */
  selection?: { date: string; stamp: Stamp };
}

const NOTICES: Partial<Record<DayState["status"], string>> = {
  error: "読み込めず",
  canvasError: "絵が損なわれておる",
};

/**
 * 日付ラベルの画面 x。日の読み始め側の端が画面外でも、その日が見えている間は
 * ラベルを画面端に付いてこさせる (ただしその日の区画からははみ出さない)。
 */
function stickyLabelX(labelX: number, segLeft: number, segWidth: number, viewport: Viewport): number {
  const natural = worldToScreen(viewport, labelX);
  const onScreen = Math.min(Math.max(natural, LABEL_MARGIN), viewport.width - LABEL_MARGIN);
  return Math.min(Math.max(onScreen, segLeft + LABEL_MARGIN), segLeft + segWidth - LABEL_MARGIN);
}

/** 絵巻の画面に映っている部分を1フレーム分描く */
export function drawEmaki(ctx: CanvasRenderingContext2D, state: DrawState): void {
  const { layout, viewport, days, current, layers, floating, selection, assetsVersion } = state;
  const dpr = state.dpr ?? 1;
  const { width, height } = viewport;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.washi;
  ctx.fillRect(0, 0, width, height);

  const visible = visibleSegments(layout, viewport);
  for (const seg of visible) {
    const sx = worldToScreen(viewport, seg.x);
    // 日の区切り線
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
    // 縦書きの日付
    ctx.fillStyle = COLORS.sumi;
    ctx.font = `${LABEL_SIZE}px "Hiragino Mincho ProN", "Yu Mincho", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    renderVerticalText(ctx, toKanjiDate(seg.date), stickyLabelX(seg.labelX, sx, seg.width, viewport), LABEL_TOP, LABEL_SIZE);

    const day = days[seg.date];
    if (day?.status === "ready") {
      const { strokes, stamps } = day.canvas;
      const exclude = floating?.date === seg.date ? floating.stamp.id : undefined;
      if (layers) {
        const layer = layers.get(seg.date, strokes, seg.width, height, dpr, stamps, exclude, assetsVersion);
        if (layer) ctx.drawImage(layer.canvas, sx + layer.x0, 0, layer.width, height);
      } else {
        stamps.filter((st) => st.id !== exclude).forEach((st) => renderStamp(ctx, st, sx));
        strokes.forEach((s) => renderStroke(ctx, s, sx));
      }
    }
    const notice = day && NOTICES[day.status];
    if (notice) {
      ctx.fillStyle = COLORS.notice;
      ctx.font = "16px serif";
      ctx.fillText(notice, sx + seg.width / 2, height / 2);
    }
  }

  layers?.retain(visible.map((s) => s.date));

  const screenXOf = (date: string) => {
    const seg = layout.segments.find((s) => s.date === date);
    return seg ? worldToScreen(viewport, seg.x) : null;
  };
  const floatX = floating && screenXOf(floating.date);
  if (floating && floatX != null) renderStamp(ctx, floating.stamp, floatX);
  const currentX = current && screenXOf(current.date);
  if (current && currentX != null) renderStroke(ctx, current.stroke, currentX);
  const selX = selection && screenXOf(selection.date);
  if (selection && selX != null) {
    renderSelection(ctx, selection.stamp, sizeOfStamp(selection.stamp), selX);
  }
}
