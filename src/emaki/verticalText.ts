/** 吹き出しの縦書きの組み方 */
import type { Size } from "./stampGeometry";

/** 1列に並べる最大文字数 */
export const MAX_PER_COLUMN = 12;
/** 吹き出しの内側の余白 (px) */
export const BUBBLE_PAD_X = 18;
export const BUBBLE_PAD_Y = 20;

/**
 * 文を縦書きの列に分ける (列は右から左へ読む順)。
 * 改行で列を改め、MAX_PER_COLUMN 文字ごとに折り返す。空行は詰める。
 */
export function layoutVertical(text: string, maxPerColumn = MAX_PER_COLUMN): string[] {
  const columns: string[] = [];
  for (const line of text.split("\n")) {
    const chars = [...line.trim()];
    for (let i = 0; i < chars.length; i += maxPerColumn) {
      columns.push(chars.slice(i, i + maxPerColumn).join(""));
    }
  }
  return columns;
}

/** 吹き出しの大きさ (素材座標)。空でも1文字分は確保する。 */
export function bubbleSize(text: string, fontSize: number): Size {
  const columns = layoutVertical(text);
  const longest = Math.max(1, ...columns.map((c) => [...c].length));
  return {
    w: Math.max(1, columns.length) * fontSize + BUBBLE_PAD_X * 2,
    h: longest * fontSize + BUBBLE_PAD_Y * 2,
  };
}

/** i 列目の中心 x (吹き出しの中心が 0、右の列から並べる) */
export function columnX(i: number, columnCount: number, fontSize: number): number {
  return ((columnCount - 1) / 2 - i) * fontSize;
}
