/** 筆跡の1点 (その日の区画内のローカル座標)。p は筆圧 0〜1、t はミリ秒。 */
export interface StrokePoint {
  x: number;
  y: number;
  p: number;
  t: number;
}

/** 筆の設定。bleed=にじみ、dryness=かすれ (いずれも 0〜1) */
export interface BrushSettings {
  size: number;
  bleed: number;
  dryness: number;
}

/** 1本の筆跡。seed により にじみ・かすれ の乱数を再現する。 */
export interface Stroke extends BrushSettings {
  id: string;
  seed: number;
  color: string;
  points: StrokePoint[];
}

/** 最も細くなったときの太さ (size に対する比率) */
export const MIN_WIDTH_RATIO = 0.1;
/** 速度 (px/ms) が太さに効く強さ */
const SPEED_K = 0.5;
/** 速く動かしても size にこの比率以上は残す */
const MIN_SPEED_FACTOR = 0.4;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);
const dist = (a: StrokePoint, b: StrokePoint) => Math.hypot(b.x - a.x, b.y - a.y);

/** minDist より近い点を間引く。最初と最後の点は必ず残す。 */
export function decimate(points: StrokePoint[], minDist: number): StrokePoint[] {
  if (points.length <= 2) return [...points];
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (dist(out[out.length - 1], points[i]) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** 描画中に点を追加する。直前の点から minDist 以上離れていれば追加。 */
export function appendPoint(
  points: StrokePoint[],
  pt: StrokePoint,
  minDist: number,
): StrokePoint[] {
  const last = points[points.length - 1];
  if (last && dist(last, pt) < minDist) return points;
  return [...points, pt];
}

/** 筆圧と速度から線の太さを決める。強く押すほど太く、速く動かすほど細い。 */
export function widthAt(pressure: number, speed: number, size: number): number {
  const speedFactor = Math.max(MIN_SPEED_FACTOR, 1 / (1 + Math.max(speed, 0) * SPEED_K));
  const w = size * (0.3 + 0.7 * clamp01(pressure)) * speedFactor;
  return Math.max(w, size * MIN_WIDTH_RATIO);
}

/** 各点の太さ。速度は直前の区間の 距離 / 経過時間 で求める。 */
export function computeWidths(points: StrokePoint[], size: number): number[] {
  const speedOf = (a: StrokePoint, b: StrokePoint) => dist(a, b) / Math.max(1, b.t - a.t);
  return points.map((p, i) => {
    const speed =
      points.length < 2 ? 0 : i === 0 ? speedOf(points[0], points[1]) : speedOf(points[i - 1], p);
    return widthAt(p.p, speed, size);
  });
}

/** Catmull-Rom スプラインで点列をなめらかにする。元の点はすべて通る。 */
export function smooth(points: StrokePoint[], steps = 4): StrokePoint[] {
  if (points.length < 2) return [...points];
  const at = (i: number) => points[Math.min(Math.max(i, 0), points.length - 1)];
  const cr = (a: number, b: number, c: number, d: number, u: number) =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  const out: StrokePoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    out.push(p1);
    for (let s = 1; s < steps; s++) {
      const u = s / steps;
      out.push({
        x: cr(p0.x, p1.x, p2.x, p3.x, u),
        y: cr(p0.y, p1.y, p2.y, p3.y, u),
        p: cr(p0.p, p1.p, p2.p, p3.p, u),
        t: cr(p0.t, p1.t, p2.t, p3.t, u),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
