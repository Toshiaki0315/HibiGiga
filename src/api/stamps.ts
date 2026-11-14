/**
 * 取り込んだスタンプ画像の API。画像は Rust 側で OS のアプリ用データフォルダに保存され、
 * リポジトリには入らない。
 */
import { invoke } from "@tauri-apps/api/core";
import { normalizeIpcError } from "./ipc";

/** 描き方: そのまま / 墨絵風 */
export type StampStyle = "original" | "ink";

export interface StampMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  style: StampStyle;
  createdAt: string;
}

const KINDS = ["invalidId", "invalidName", "invalidImage", "tooLarge", "notFound", "corrupted", "io"] as const;
export type StampErrorKind = (typeof KINDS)[number] | "unknown";

export class StampError extends Error {
  readonly kind: StampErrorKind;

  constructor(kind: StampErrorKind, message: string) {
    super(message);
    this.name = "StampError";
    this.kind = kind;
  }
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const { kind, message } = normalizeIpcError(e, KINDS);
    throw new StampError(kind, message);
  }
}

/** 縮小・PNG 再エンコード済み (EXIF 除去済み) の画像を取り込む */
export function importStamp(name: string, pngBase64: string, style: StampStyle): Promise<StampMeta> {
  return call<StampMeta>("import_stamp", { name, pngBase64, style });
}

export function listStamps(): Promise<StampMeta[]> {
  return call<StampMeta[]>("list_stamps");
}

/** 画像 (PNG) を base64 で読み込む */
export function loadStampImage(id: string): Promise<string> {
  return call<string>("load_stamp_image", { id });
}

export async function deleteStamp(id: string): Promise<void> {
  await call<null>("delete_stamp", { id });
}
