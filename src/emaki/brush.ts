import { computeWidths, smooth, type Stroke } from "./stroke";

/** 筆の毛の本数。かすれは毛ごとに墨が途切れることで表現する。 */
export const BRISTLES = 8;

/** 描画の最小単位 (円)。kind=bleed はにじみ、core は毛先。progress は筆跡上の位置 0〜1。 */
export interface Dab {
  x: number;
  y: number;
  r: number;
  alpha: number;
  kind: "core" | "bleed";
  progress: number;
  /** core のみ: 何本目の毛か */
  bristle?: number;
}

interface Sample {
  x: number;
  y: number;
  w: number;
  progress: number;
  /** 進行方向に垂直な単位ベクトル */
  nx: number;
  ny: number;
}

/** シード付き疑似乱数 (mulberry32)。同じシードなら同じ並びを返す。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** かすれの状態が切り替わる速さ (小さいほど筋が長い) */
const SWITCH_RATE = 0.12;

/** 毛1本の円の半径 (隣の毛と少し重なり、筆圧が強い所は面になる) */
const bristleRadius = (w: number) => Math.max(0.6, (w / BRISTLES) * 0.75);

/**
 * なめらかにした筆跡の上を歩いてサンプル点を作る。
 * 毛の線が途切れないよう、間隔は毛の半径以下にする。
 */
function sampleStroke(stroke: Stroke): Sample[] {
  const pts = smooth(stroke.points);
  const widths = computeWidths(pts, stroke.size);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total === 0) {
    return [{ x: pts[0].x, y: pts[0].y, w: widths[0], progress: 0, nx: 0, ny: 1 }];
  }
  const samples: Sample[] = [];
  let seg = 0;
  for (let s = 0; s <= total; ) {
    while (seg < pts.length - 2 && cum[seg + 1] <= s) seg++;
    const a = pts[seg];
    const b = pts[seg + 1];
    const len = cum[seg + 1] - cum[seg];
    const u = len === 0 ? 0 : (s - cum[seg]) / len;
    const w = widths[seg] + (widths[seg + 1] - widths[seg]) * u;
    const [nx, ny] = len === 0 ? [0, 1] : [-(b.y - a.y) / len, (b.x - a.x) / len];
    samples.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, w, progress: s / total, nx, ny });
    s += Math.max(0.5, bristleRadius(w));
  }
  return samples;
}

/** 筆跡を にじみ・かすれ 込みの円の集合に変換する (純粋関数) */
export function generateDabs(stroke: Stroke): Dab[] {
  if (stroke.points.length === 0) return [];
  const rand = mulberry32(stroke.seed);
  const samples = sampleStroke(stroke);
  const bleedDabs: Dab[] = [];
  const coreDabs: Dab[] = [];
  const bleedCount = stroke.bleed > 0 ? Math.max(1, Math.round(stroke.bleed * 3)) : 0;
  // 毛ごとのわずかな位置ずれ (筆跡全体で固定し、毛の線をまっすぐ保つ)
  const bristleJitter = Array.from({ length: BRISTLES }, () => (rand() - 0.5) * 0.08);
  // 毛ごとの「墨切れ」状態。状態はしばらく続くので、かすれが筋になる
  const dry = new Array<boolean>(BRISTLES).fill(false);
  let travelled = 0;
  let nextBleedAt = 0;

  samples.forEach((s, i) => {
    if (i > 0) travelled += Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y);
    // にじみ: 線の周囲に薄く大きな墨だまりを散らす (太さの3割ごと)
    if (travelled >= nextBleedAt) {
      nextBleedAt = travelled + s.w * 0.3;
      for (let k = 0; k < bleedCount; k++) {
        const angle = rand() * Math.PI * 2;
        const d = rand() * s.w * (0.5 + stroke.bleed);
        bleedDabs.push({
          x: s.x + Math.cos(angle) * d,
          y: s.y + Math.sin(angle) * d,
          r: s.w * (0.4 + 0.6 * stroke.bleed) * (0.5 + rand() * 0.5),
          alpha: 0.04 + 0.08 * stroke.bleed,
          kind: "bleed",
          progress: s.progress,
        });
      }
    }
    // かすれ: 毛ごとに、筆跡の終わりほど高い割合で墨が途切れる。
    // 状態の切り替わりを SWITCH_RATE 倍に抑え、平均の途切れ割合は dropChance のまま筋状にする。
    const dropChance = stroke.dryness * (0.15 + 0.85 * s.progress);
    const r = bristleRadius(s.w);
    for (let b = 0; b < BRISTLES; b++) {
      const flip = rand();
      dry[b] = dry[b] ? flip >= (1 - dropChance) * SWITCH_RATE : flip < dropChance * SWITCH_RATE;
      if (dry[b]) continue;
      const offset = ((b + 0.5) / BRISTLES - 0.5 + bristleJitter[b]) * s.w * 0.9;
      coreDabs.push({
        x: s.x + s.nx * offset,
        y: s.y + s.ny * offset,
        r,
        alpha: 0.85 * (1 - 0.3 * stroke.dryness * s.progress),
        kind: "core",
        progress: s.progress,
        bristle: b,
      });
    }
  });
  return [...bleedDabs, ...coreDabs];
}

const dabCache = new WeakMap<Stroke, Dab[]>();

/** generateDabs の結果を筆跡オブジェクトごとに使い回す (筆跡は不変として扱う) */
export function getDabs(stroke: Stroke): Dab[] {
  let dabs = dabCache.get(stroke);
  if (!dabs) {
    dabs = generateDabs(stroke);
    dabCache.set(stroke, dabs);
  }
  return dabs;
}

/** 筆跡を描く。originX はその日の区画の画面上の左端。 */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, originX: number): void {
  ctx.save();
  ctx.fillStyle = stroke.color;
  for (const d of getDabs(stroke)) {
    ctx.globalAlpha = d.alpha;
    ctx.beginPath();
    ctx.arc(originX + d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 縦書きの句読点のずらし量 (文字の大きさに対する比率)。
 * 横書き用の字形は「。」「、」が文字枠の左下にあるので、右上へ移して縦書きの位置にする。
 */
export const VERTICAL_PUNCT_SHIFT = 0.55;
const VERTICAL_PUNCT = new Set(["。", "、", "，", "．"]);
/**
 * 縦書きで90°回して描く文字 (長音・波線・ダッシュ・三点リーダー・括弧)。
 * 横書き用の字形を時計回りに回すと縦書きの形 (｜、﹁﹂ など) になる。
 */
export const VERTICAL_ROTATED = new Set([
  "ー", "〜", "～", "―", "…", "「", "」", "『", "』", "（", "）", "(", ")",
]);

/** 縦書きで文字列を描く (1文字ずつ下へ) */
export function renderVerticalText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
): void {
  const shift = fontSize * VERTICAL_PUNCT_SHIFT;
  [...text].forEach((ch, i) => {
    const top = y + i * fontSize;
    if (VERTICAL_ROTATED.has(ch)) {
      // 文字枠の中心で回す (textBaseline=top 前提で、字形の中心を原点に合わせる)
      ctx.save();
      ctx.translate(x, top + fontSize / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(ch, 0, -fontSize / 2);
      ctx.restore();
      return;
    }
    const d = VERTICAL_PUNCT.has(ch) ? shift : 0;
    ctx.fillText(ch, x + d, top - d);
  });
}
