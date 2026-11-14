/** Tauri コマンドが返すエラー ({kind, message} 等) を種類とメッセージに正規化する */
export function normalizeIpcError<K extends string>(
  e: unknown,
  known: readonly K[],
): { kind: K | "unknown"; message: string } {
  if (typeof e === "object" && e !== null && "message" in e) {
    const { kind, message } = e as { kind?: unknown; message: unknown };
    return { kind: known.find((k) => k === kind) ?? "unknown", message: String(message) };
  }
  return { kind: "unknown", message: String(e) };
}
