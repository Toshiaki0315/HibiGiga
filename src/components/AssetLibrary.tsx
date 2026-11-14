import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { errorMessage } from "../api/diary";
import type { StampStyle } from "../api/stamps";
import { CATEGORIES, assetsIn, type AssetCategory } from "../assets/catalog";
import { ACCEPTED_TYPES, defaultStampName, prepareImage } from "../assets/imageImport";
import { parseUserAssetId, userAssetId, type UserAssetStore } from "../assets/userAssets";
import { renderStamp, sizeOfStamp } from "../emaki/stampRender";

export interface AssetLibraryProps {
  /** 素材をドラッグして離した (画面座標) */
  onDrop(assetId: string, clientX: number, clientY: number): void;
  /** 素材をタップ / Enter した (画面中央に置く) */
  onPlace(assetId: string): void;
  /** 取り込んだスタンプ。渡すと「自作」タブが出る。 */
  userAssets?: UserAssetStore;
  /** 画像の前処理 (縮小・PNG 再エンコード)。テスト用に差し替え可。 */
  prepare?: typeof prepareImage;
  /** 削除の確認。テスト用に差し替え可。 */
  confirmDelete?: (name: string) => boolean;
}

type Tab = AssetCategory | "user";

interface Item {
  assetId: string;
  name: string;
}

interface Pending {
  pngBase64: string;
  name: string;
  style: StampStyle;
}

const THUMB = 56;
const THUMB_PADDING = 4;
/** これ以上動いたらタップではなくドラッグとみなす (px) */
const DRAG_THRESHOLD = 4;

const NO_STORE = { subscribe: () => () => {}, getSnapshot: () => null };
const defaultConfirm = (name: string) => window.confirm(`「${name}」を削除しますか？ この絵を使った日記には「？」が表示されます。`);

function Thumbnail({ assetId, version }: { assetId: string; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = window.devicePixelRatio;
  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, THUMB, THUMB);
    const base = { id: assetId, assetId, x: THUMB / 2, y: THUMB / 2, scale: 1, rotation: 0, flipX: false };
    const { w, h } = sizeOfStamp(base);
    const fit = Math.min((THUMB - THUMB_PADDING * 2) / w, (THUMB - THUMB_PADDING * 2) / h);
    renderStamp(ctx, { ...base, scale: fit }, 0);
  }, [assetId, dpr, version]);
  return (
    <canvas
      ref={ref}
      width={THUMB * dpr}
      height={THUMB * dpr}
      style={{ width: `${THUMB}px`, height: `${THUMB}px` }}
      aria-hidden="true"
    />
  );
}

interface Drag {
  item: Item;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

/** 左ペインの素材ライブラリ。マウス・ペン・指のいずれでもドラッグできる。 */
export function AssetLibrary({
  onDrop,
  onPlace,
  userAssets,
  prepare = prepareImage,
  confirmDelete = defaultConfirm,
}: AssetLibraryProps) {
  const [tab, setTab] = useState<Tab>("animal");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = useSyncExternalStore(
    (userAssets ?? NO_STORE).subscribe,
    (userAssets ?? NO_STORE).getSnapshot,
  );
  const version = user?.version ?? 0;

  const items: Item[] =
    tab === "user"
      ? (user?.stamps ?? []).map((m) => ({ assetId: userAssetId(m.id), name: m.name }))
      : assetsIn(tab).map((a) => ({ assetId: a.id, name: a.name }));

  function handlePointerDown(item: Item, e: PointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ item, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false });
  }

  function handlePointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const moved =
      drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
  }

  function handlePointerUp(e: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    setDrag(null);
    if (drag.moved) onDrop(drag.item.assetId, e.clientX, e.clientY);
    else onPlace(drag.item.assetId);
  }

  function handleKeyDown(item: Item, e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPlace(item.assetId);
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    try {
      const { pngBase64 } = await prepare(file);
      setPending({ pngBase64, name: defaultStampName(file.name), style: "original" });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    try {
      await userAssets!.importImage(pending!.name, pending!.pngBase64, pending!.style);
      setPending(null);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirmDelete(name)) return;
    try {
      await userAssets!.remove(id);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const tabs: { id: Tab; label: string }[] = userAssets
    ? [...CATEGORIES, { id: "user", label: "自作" }]
    : CATEGORIES;

  return (
    <aside className="asset-library" aria-label="素材">
      <div role="tablist" className="asset-tabs">
        {tabs.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} onClick={() => setTab(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {tab === "user" && (
        <div className="user-import">
          <label className="import-button">
            画像を取り込む
            <input type="file" accept={ACCEPTED_TYPES.join(",")} onChange={handleFile} hidden />
          </label>
          {pending && (
            <form className="import-form" onSubmit={handleImport}>
              <label>
                名前
                <input
                  value={pending.name}
                  maxLength={40}
                  onChange={(e) => setPending({ ...pending, name: e.currentTarget.value })}
                />
              </label>
              <fieldset>
                <legend>描き方</legend>
                {(
                  [
                    ["original", "そのまま"],
                    ["ink", "墨絵風"],
                  ] as const
                ).map(([style, label]) => (
                  <label key={style}>
                    <input
                      type="radio"
                      name="stamp-style"
                      checked={pending.style === style}
                      onChange={() => setPending({ ...pending, style })}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="row">
                <button type="submit">取り込む</button>
                <button type="button" onClick={() => setPending(null)}>
                  やめる
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="status error" role="alert">
              {error}
            </p>
          )}
          {items.length === 0 && (
            <p className="status">まだ自作のスタンプはありませぬ。「画像を取り込む」から選んでくだされ。</p>
          )}
        </div>
      )}

      <div className="asset-items">
        {items.map((item) => (
          <div key={item.assetId} className="asset-cell">
            <button
              type="button"
              className="asset-item"
              aria-label={item.name}
              title={item.name}
              onPointerDown={(e) => handlePointerDown(item, e)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => handleKeyDown(item, e)}
            >
              <Thumbnail assetId={item.assetId} version={version} />
            </button>
            {tab === "user" && (
              <button
                type="button"
                className="asset-delete"
                aria-label={`${item.name}を削除`}
                onClick={() => handleDelete(parseUserAssetId(item.assetId)!, item.name)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {drag?.moved && (
        <div className="drag-ghost" data-testid="drag-ghost" style={{ left: `${drag.x}px`, top: `${drag.y}px` }}>
          <Thumbnail assetId={drag.item.assetId} version={version} />
          <span>{drag.item.name}</span>
        </div>
      )}
    </aside>
  );
}
