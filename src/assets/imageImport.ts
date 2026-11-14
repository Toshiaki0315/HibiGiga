/**
 * スタンプ画像の取り込み前処理。
 * 長辺を MAX_IMPORT_EDGE に縮小し PNG に再エンコードする。再エンコードにより写真の
 * EXIF (撮影位置 GPS など) は保存されない。
 */

export const MAX_IMPORT_EDGE = 1024;
/** 取り込める画像の種類 (SVG はスクリプトを含みうるため対象外) */
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_NAME_CHARS = 40;

export class ImageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageImportError";
  }
}

/** 画像の読み込み・書き出し (ブラウザの機能。テストでは差し替える) */
export interface ImageCodec {
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource }>;
  /** 指定の大きさで描いて PNG (base64、data: 接頭辞なし) にする */
  encodePng(source: CanvasImageSource, w: number, h: number): Promise<string>;
}

/** 縦横比を保って長辺を max 以内に収める (拡大はしない) */
export function fitSize(w: number, h: number, max = MAX_IMPORT_EDGE): { w: number; h: number } {
  const ratio = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
}

/** ファイル名から既定のスタンプ名を作る (拡張子を除き 40 文字まで) */
export function defaultStampName(fileName: string): string {
  const base = [...fileName.replace(/\.[^.]*$/, "").trim()].slice(0, MAX_NAME_CHARS).join("");
  return base || "スタンプ";
}

/* v8 ignore start -- ブラウザの画像処理 API (jsdom 非対応) を呼ぶだけの接着部分 */
export const browserCodec: ImageCodec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  async encodePng(source, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(source, 0, 0, w, h);
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  },
};
/* v8 ignore stop */

export async function prepareImage(
  file: File,
  codec: ImageCodec = browserCodec,
): Promise<{ pngBase64: string; width: number; height: number }> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageImportError("PNG・JPEG・WebP の画像のみ取り込めます");
  }
  let decoded: Awaited<ReturnType<ImageCodec["decode"]>>;
  try {
    decoded = await codec.decode(file);
  } catch {
    throw new ImageImportError("画像を読み込めませぬ");
  }
  const { w, h } = fitSize(decoded.width, decoded.height);
  const pngBase64 = await codec.encodePng(decoded.source, w, h);
  return { pngBase64, width: w, height: h };
}
