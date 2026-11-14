/**
 * スタンプの座標変換・当たり判定・変形操作 (純粋関数)。
 * 座標はすべてその日の区画内のローカル座標。スタンプの「素材座標」は中心を原点とし、
 * 反転 → 拡大 → 回転 → 平行移動 の順で区画座標に写す。
 */
import type { Stamp } from "./canvasData";

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 5;
/** つまみの当たり判定の半径 (px) */
export const HANDLE_RADIUS = 12;
/** 回転つまみを上辺からどれだけ離すか (px、拡大率に依らず一定) */
export const ROTATE_HANDLE_OFFSET = 28;
const SNAP_STEP = Math.PI / 12; // 15°

export function fromStampLocal(s: Stamp, q: Point): Point {
  const x = (s.flipX ? -q.x : q.x) * s.scale;
  const y = q.y * s.scale;
  const cos = Math.cos(s.rotation);
  const sin = Math.sin(s.rotation);
  return { x: s.x + x * cos - y * sin, y: s.y + x * sin + y * cos };
}

export function toStampLocal(s: Stamp, p: Point): Point {
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  const cos = Math.cos(s.rotation);
  const sin = Math.sin(s.rotation);
  const x = (dx * cos + dy * sin) / s.scale;
  const y = (-dx * sin + dy * cos) / s.scale;
  return { x: s.flipX ? -x : x, y };
}

/** 四隅 (素材の左上・右上・右下・左下の順) */
export function corners(s: Stamp, size: Size): Point[] {
  const w = size.w / 2;
  const h = size.h / 2;
  return [
    { x: -w, y: -h },
    { x: w, y: -h },
    { x: w, y: h },
    { x: -w, y: h },
  ].map((q) => fromStampLocal(s, q));
}

export function stampBounds(s: Stamp, size: Size) {
  const c = corners(s, size);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function contains(s: Stamp, size: Size, p: Point): boolean {
  const q = toStampLocal(s, p);
  return Math.abs(q.x) <= size.w / 2 && Math.abs(q.y) <= size.h / 2;
}

/** 点の下にある一番上 (配列の後ろ) のスタンプ */
export function hitTest(stamps: Stamp[], sizeOf: (stamp: Stamp) => Size, p: Point): Stamp | null {
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (contains(stamps[i], sizeOf(stamps[i]), p)) return stamps[i];
  }
  return null;
}

export function rotateHandlePos(s: Stamp, size: Size): Point {
  return fromStampLocal(s, { x: 0, y: -size.h / 2 - ROTATE_HANDLE_OFFSET / s.scale });
}

const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= HANDLE_RADIUS;

/** 点が拡大縮小 (四隅) / 回転 (上辺の上) のつまみに当たっているか */
export function handleAt(s: Stamp, size: Size, p: Point): "scale" | "rotate" | null {
  if (corners(s, size).some((c) => near(c, p))) return "scale";
  if (near(rotateHandlePos(s, size), p)) return "rotate";
  return null;
}

export function moveBy(s: Stamp, dx: number, dy: number): Stamp {
  return { ...s, x: s.x + dx, y: s.y + dy };
}

/** 中心と縦横比を保ったまま、角が点に来るように拡大縮小する */
export function resizeTo(s: Stamp, size: Size, p: Point): Stamp {
  const scale = Math.hypot(p.x - s.x, p.y - s.y) / Math.hypot(size.w / 2, size.h / 2);
  return { ...s, scale: Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE) };
}

/** スタンプの上方向が点を向くように回転する。snap なら15°刻み。 */
export function rotateTo(s: Stamp, p: Point, snap: boolean): Stamp {
  const angle = Math.atan2(p.x - s.x, -(p.y - s.y));
  return { ...s, rotation: snap ? Math.round(angle / SNAP_STEP) * SNAP_STEP : angle };
}
