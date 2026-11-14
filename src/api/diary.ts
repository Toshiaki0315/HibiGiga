/**
 * 日記のセーブ/ロードAPI。RustバックエンドのTauriコマンドを型付きで呼び出す。
 */
import { invoke } from "@tauri-apps/api/core";
import { normalizeIpcError } from "./ipc";

/** 1日分の日記 (Rust側 `DiaryEntry` と対応) */
export interface DiaryEntry {
  /** `YYYY-MM-DD` */
  date: string;
  text: string;
  /** キャンバス状態。形式は後続フェーズで定義する。 */
  canvas?: unknown;
  /** 最終更新日時 (RFC3339)。保存時にバックエンドが設定する。 */
  updatedAt?: string;
}

export type DiaryErrorKind = "invalidDate" | "corrupted" | "io" | "unknown";

export class DiaryError extends Error {
  readonly kind: DiaryErrorKind;

  constructor(kind: DiaryErrorKind, message: string) {
    super(message);
    this.name = "DiaryError";
    this.kind = kind;
  }
}

/** `YYYY-MM-DD` 形式の実在する日付か */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const KNOWN_KINDS: readonly DiaryErrorKind[] = ["invalidDate", "corrupted", "io"];

/** invoke が投げた任意の値を DiaryError に正規化する */
function toDiaryError(e: unknown): DiaryError {
  const { kind, message } = normalizeIpcError(e, KNOWN_KINDS);
  return new DiaryError(kind, message);
}

function assertValidDate(date: string): void {
  if (!isValidDate(date)) {
    throw new DiaryError("invalidDate", `invalid date: ${JSON.stringify(date)}`);
  }
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toDiaryError(e);
  }
}

export async function saveDiary(entry: DiaryEntry): Promise<DiaryEntry> {
  assertValidDate(entry.date);
  return call<DiaryEntry>("save_diary", { entry });
}

export async function loadDiary(date: string): Promise<DiaryEntry | null> {
  assertValidDate(date);
  return call<DiaryEntry | null>("load_diary", { date });
}

export async function listDiaryDates(): Promise<string[]> {
  return call<string[]>("list_diary_dates");
}

/** Date をローカル時刻の `YYYY-MM-DD` に整形する */
export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 例外を画面表示用のメッセージにする */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 日記の文を古風な文に変換する (Rust の規則ベース変換) */
export async function convertKofu(text: string): Promise<string> {
  return call<string>("convert_kofu", { text });
}
