import { useState } from "react";
import { convertKofu, errorMessage } from "../api/diary";

export interface KofuPanelProps {
  /** 変換元 (日記の本文) */
  source: string;
  /** 変換関数 (既定は Rust の convert_kofu) */
  convert?: (text: string) => Promise<string>;
  /** 吹き出しとして絵巻に置く。置けなければ false。 */
  onPlace(text: string): boolean;
}

/** 本文を古風な文に変換し、確かめて (直して) から吹き出しとして置く */
export function KofuPanel({ source, convert = convertKofu, onPlace }: KofuPanelProps) {
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert() {
    setBusy(true);
    try {
      setResult(await convert(source));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function handlePlace() {
    setError(onPlace(result) ? null : "絵巻に置けませぬ (描ける日が見えておらぬ)");
  }

  return (
    <section className="kofu-panel" aria-label="古風変換">
      <div className="row">
        <button type="button" onClick={handleConvert} disabled={busy || source.trim() === ""}>
          {busy ? "変換中…" : "古風に変換"}
        </button>
        <button type="button" onClick={handlePlace} disabled={result.trim() === ""}>
          吹き出しにして置く
        </button>
      </div>
      <label>
        古風の文
        <textarea value={result} onChange={(e) => setResult(e.currentTarget.value)} rows={3} />
      </label>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
