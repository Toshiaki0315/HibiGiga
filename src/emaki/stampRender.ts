import { PHRASE_FONT_SIZE, findAsset, type InkAsset } from "../assets/catalog";
import { renderStroke, renderVerticalText } from "./brush";
import type { StampMeta } from "../api/stamps";
import { fitSize } from "../assets/imageImport";
import { parseUserAssetId } from "../assets/userAssets";
import type { Stamp } from "./canvasData";
import { corners, fromStampLocal, rotateHandlePos, type Size } from "./stampGeometry";
import type { Stroke } from "./stroke";
import { BUBBLE_PAD_Y, bubbleSize, columnX, layoutVertical } from "./verticalText";

export interface UserAssetResolver {
  meta(id: string): StampMeta | undefined;
  image(id: string): CanvasImageSource | undefined;
}
/** 取り込んだスタンプの既定の表示サイズ (長辺 px) */
export const USER_STAMP_EDGE = 160;
/** 墨絵風: 白黒にしてコントラストを上げ、和紙の色に乗算で重ねる */
export const INK_FILTER = "grayscale(1) contrast(1.6)";

let userAssets: UserAssetResolver | null = null;

/** 取り込んだスタンプ (assetId "user:<id>") の情報と画像の取得元を登録する */
export function setUserAssetResolver(resolver: UserAssetResolver | null): void {
  userAssets = resolver;
}

/** 素材一覧に無いスタンプの代わりの絵の大きさ */
export const PLACEHOLDER_SIZE: Size = { w: 40, h: 40 };

const SUMI = "#1f1b16";
const SELECTION = "#b0302a";
const HANDLE_DRAW_RADIUS = 6;
const MS_PER_POINT = 16;

/** スタンプ id から にじみ・かすれ の乱数シードを作る (FNV-1a) */
export function stampSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const strokeCache = new Map<string, Stroke[]>();

/** 線画素材を、素材の中心を原点とする筆跡の列に変換する (素材×シードごとにキャッシュ) */
export function stampStrokes(asset: InkAsset, seed: number): Stroke[] {
  const key = `${asset.id}:${seed}`;
  let strokes = strokeCache.get(key);
  if (!strokes) {
    strokes = asset.lines.map((line, i) => ({
      id: `${asset.id}-${i}`,
      seed: (seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0,
      color: SUMI,
      ...asset.brush,
      points: line.map(([x, y, p], j) => ({
        x: x - asset.width / 2,
        y: y - asset.height / 2,
        p,
        t: j * MS_PER_POINT,
      })),
    }));
    strokeCache.set(key, strokes);
  }
  return strokes;
}

/** スタンプの大きさ (素材座標)。吹き出しは文の長さで決まる。 */
export function sizeOfStamp(stamp: Stamp): Size {
  const userId = parseUserAssetId(stamp.assetId);
  if (userId !== null) {
    const meta = userAssets?.meta(userId);
    return meta ? fitSize(meta.width, meta.height, USER_STAMP_EDGE) : PLACEHOLDER_SIZE;
  }
  const asset = findAsset(stamp.assetId);
  if (!asset) return PLACEHOLDER_SIZE;
  if (asset.category === "phrase") return bubbleSize(stamp.text ?? asset.text, PHRASE_FONT_SIZE);
  return { w: asset.width, h: asset.height };
}

/** スタンプを描く。originX はその日の区画の画面上の左端。 */
function renderPlaceholder(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = SELECTION;
  ctx.strokeRect(-PLACEHOLDER_SIZE.w / 2, -PLACEHOLDER_SIZE.h / 2, PLACEHOLDER_SIZE.w, PLACEHOLDER_SIZE.h);
  ctx.fillStyle = SELECTION;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("？", 0, 0);
}

/** 取り込んだスタンプ。読み込み中は点線の枠、消えていれば代わりの絵。 */
function renderUserStamp(ctx: CanvasRenderingContext2D, stamp: Stamp, userId: string): void {
  const meta = userAssets?.meta(userId);
  if (!meta) return renderPlaceholder(ctx);
  const { w, h } = sizeOfStamp(stamp);
  const img = userAssets!.image(userId);
  if (!img) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = SELECTION;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    return;
  }
  if (meta.style === "ink") {
    ctx.filter = INK_FILTER;
    ctx.globalCompositeOperation = "multiply";
  }
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
}

/** スタンプを描く。originX はその日の区画の画面上の左端。 */
export function renderStamp(ctx: CanvasRenderingContext2D, stamp: Stamp, originX: number): void {
  const userId = parseUserAssetId(stamp.assetId);
  const asset = userId === null ? findAsset(stamp.assetId) : undefined;
  ctx.save();
  ctx.translate(originX + stamp.x, stamp.y);
  ctx.rotate(stamp.rotation);
  // 吹き出しは文字が鏡文字にならないよう反転しない
  const flip = stamp.flipX && asset?.category !== "phrase";
  ctx.scale(flip ? -stamp.scale : stamp.scale, stamp.scale);

  if (userId !== null) {
    renderUserStamp(ctx, stamp, userId);
  } else if (!asset) {
    renderPlaceholder(ctx);
  } else if (asset.category === "phrase") {
    const text = stamp.text ?? asset.text;
    const { w, h } = bubbleSize(text, PHRASE_FONT_SIZE);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2);
    ctx.fillStyle = "rgba(255, 252, 240, 0.85)";
    ctx.fill();
    ctx.strokeStyle = SUMI;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = SUMI;
    ctx.font = `${PHRASE_FONT_SIZE}px "Hiragino Mincho ProN", "Yu Mincho", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const columns = layoutVertical(text);
    columns.forEach((col, i) =>
      renderVerticalText(ctx, col, columnX(i, columns.length, PHRASE_FONT_SIZE), -h / 2 + BUBBLE_PAD_Y, PHRASE_FONT_SIZE),
    );
  } else {
    stampStrokes(asset, stampSeed(stamp.id)).forEach((s) => renderStroke(ctx, s, 0));
  }
  ctx.restore();
}

/** 選択中のスタンプの枠とつまみを描く */
export function renderSelection(
  ctx: CanvasRenderingContext2D,
  stamp: Stamp,
  size: Size,
  originX: number,
): void {
  const c = corners(stamp, size);
  const top = fromStampLocal(stamp, { x: 0, y: -size.h / 2 });
  const rot = rotateHandlePos(stamp, size);
  ctx.save();
  ctx.strokeStyle = SELECTION;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(c[0].x + originX, c[0].y);
  c.slice(1).forEach((p) => ctx.lineTo(p.x + originX, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(top.x + originX, top.y);
  ctx.lineTo(rot.x + originX, rot.y);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  for (const p of [...c, rot]) {
    ctx.beginPath();
    ctx.arc(p.x + originX, p.y, HANDLE_DRAW_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
