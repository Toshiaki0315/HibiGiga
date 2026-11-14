/** 絵巻の進行方向。rtl は本物の絵巻と同じく右から左へ読み進める。 */
export type Direction = "rtl" | "ltr";

/** 絵巻 (ワールド座標) のうち画面に映っている範囲。scrollX は画面左端のワールドx。 */
export interface Viewport {
  scrollX: number;
  width: number;
  height: number;
}

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

const LINE_HEIGHT_PX = 16;

export function worldToScreen(vp: Viewport, x: number): number {
  return x - vp.scrollX;
}

export function screenToWorld(vp: Viewport, x: number): number {
  return x + vp.scrollX;
}

export function clampScroll(scrollX: number, width: number, contentWidth: number): number {
  return Math.min(Math.max(scrollX, 0), Math.max(contentWidth - width, 0));
}

export function scrollBy(vp: Viewport, dx: number, contentWidth: number): Viewport {
  return { ...vp, scrollX: clampScroll(vp.scrollX + dx, vp.width, contentWidth) };
}

/**
 * ホイール入力を横スクロール量に変換する。
 * 縦ホイールは「読み進める方向」へ、横ホイール (トラックパッド) はそのまま使う。
 */
export function wheelToScroll(e: WheelLike, direction: Direction, pageWidth: number): number {
  const scale = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? pageWidth : 1;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return e.deltaX * scale;
  return (direction === "rtl" ? -e.deltaY : e.deltaY) * scale;
}

/** 画面サイズ変更時、中央に映っていた位置を保ったままリサイズする */
export function resizeViewport(
  vp: Viewport,
  width: number,
  height: number,
  contentWidth: number,
): Viewport {
  const center = vp.scrollX + vp.width / 2;
  return { scrollX: clampScroll(center - width / 2, width, contentWidth), width, height };
}
