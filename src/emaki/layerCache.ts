import { getDabs, renderStroke } from "./brush";
import { stampBounds } from "./stampGeometry";
import { renderStamp, sizeOfStamp } from "./stampRender";
import type { Stamp } from "./canvasData";
import type { Stroke } from "./stroke";

/** 1日分の保存済み筆跡を描いた画像 */
export interface Layer {
  canvas: HTMLCanvasElement;
  /** 画像の左端の、その日の区画内ローカル x (区画外にはみ出す筆跡があれば負) */
  x0: number;
  /** 画像の幅 (CSS px) */
  width: number;
}

const NO_STAMPS: Stamp[] = [];
/** スタンプのにじみ・かすれが枠を少しはみ出す分 */
const STAMP_MARGIN = 8;

interface Entry {
  strokes: Stroke[];
  stamps: Stamp[];
  exclude: string | undefined;
  assetsVersion: number;
  dayWidth: number;
  height: number;
  dpr: number;
  layer: Layer;
}

/**
 * 保存済みの筆跡を日ごとに画像として描いておき、毎フレームはそれを貼るだけにする。
 * 筆跡の配列は不変として扱い、配列が差し替わった時 (筆跡追加) だけ描き直す。
 */
export class LayerCache {
  private entries = new Map<string, Entry>();

  get size(): number {
    return this.entries.size;
  }

  get(
    date: string,
    strokes: Stroke[],
    dayWidth: number,
    height: number,
    dpr: number,
    stamps: Stamp[] = NO_STAMPS,
    exclude?: string,
    assetsVersion = 0,
  ): Layer | null {
    const shown = exclude === undefined ? stamps : stamps.filter((s) => s.id !== exclude);
    if (strokes.length === 0 && shown.length === 0) {
      this.entries.delete(date);
      return null;
    }
    const cached = this.entries.get(date);
    if (
      cached &&
      cached.strokes === strokes &&
      cached.stamps === stamps &&
      cached.exclude === exclude &&
      cached.assetsVersion === assetsVersion &&
      cached.dayWidth === dayWidth &&
      cached.height === height &&
      cached.dpr === dpr
    ) {
      return cached.layer;
    }
    const layer = renderLayer(strokes, shown, dayWidth, height, dpr);
    this.entries.set(date, { strokes, stamps, exclude, assetsVersion, dayWidth, height, dpr, layer });
    return layer;
  }

  /** 指定した日以外の画像を捨てる (メモリ節約) */
  retain(dates: Iterable<string>): void {
    const keep = new Set(dates);
    for (const date of [...this.entries.keys()]) {
      if (!keep.has(date)) this.entries.delete(date);
    }
  }
}

function renderLayer(
  strokes: Stroke[],
  stamps: Stamp[],
  dayWidth: number,
  height: number,
  dpr: number,
): Layer {
  // 区画からはみ出した筆跡・スタンプも切れないよう、全てを含む範囲を画像にする
  let min = 0;
  let max = dayWidth;
  for (const st of stamps) {
    const b = stampBounds(st, sizeOfStamp(st));
    min = Math.min(min, b.minX - STAMP_MARGIN);
    max = Math.max(max, b.maxX + STAMP_MARGIN);
  }
  for (const s of strokes) {
    for (const d of getDabs(s)) {
      min = Math.min(min, d.x - d.r);
      max = Math.max(max, d.x + d.r);
    }
  }
  const x0 = Math.floor(min) - 1;
  const width = Math.ceil(max) + 1 - x0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // スタンプが下、筆跡が上
  stamps.forEach((st) => renderStamp(ctx, st, -x0));
  strokes.forEach((s) => renderStroke(ctx, s, -x0));
  return { canvas, x0, width };
}
