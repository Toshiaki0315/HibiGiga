/**
 * 取り込んだスタンプ画像 (自作スタンプ) の一覧と画像のキャッシュ。
 * 日記の中では assetId "user:<id>" で参照する。
 */
import { errorMessage } from "../api/diary";
import {
  deleteStamp,
  importStamp,
  listStamps,
  loadStampImage,
  type StampMeta,
  type StampStyle,
} from "../api/stamps";

export interface UserAssetApi {
  listStamps(): Promise<StampMeta[]>;
  loadStampImage(id: string): Promise<string>;
  importStamp(name: string, pngBase64: string, style: StampStyle): Promise<StampMeta>;
  deleteStamp(id: string): Promise<void>;
}

export interface UserAssetsSnapshot {
  ready: boolean;
  stamps: StampMeta[];
  /** 画像の読み込み等で描き直しが必要になるたびに増える */
  version: number;
  error?: string;
}

const PREFIX = "user:";

export const userAssetId = (id: string) => `${PREFIX}${id}`;

export function parseUserAssetId(assetId: string): string | null {
  return assetId.startsWith(PREFIX) ? assetId.slice(PREFIX.length) : null;
}

const defaultApi: UserAssetApi = { listStamps, loadStampImage, importStamp, deleteStamp };

/* v8 ignore start -- ブラウザの画像デコード (jsdom 非対応) */
async function decodePng(pngBase64: string): Promise<CanvasImageSource> {
  const img = new Image();
  img.src = `data:image/png;base64,${pngBase64}`;
  await img.decode();
  return img;
}
/* v8 ignore stop */

export class UserAssetStore {
  private snapshot: UserAssetsSnapshot = { ready: false, stamps: [], version: 0 };
  private listeners = new Set<() => void>();
  private images = new Map<string, CanvasImageSource>();
  /** 読み込み中・失敗済み (再試行しない) */
  private requested = new Set<string>();

  constructor(
    private readonly api: UserAssetApi = defaultApi,
    private readonly loadImage: (pngBase64: string) => Promise<CanvasImageSource> = decodePng,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): UserAssetsSnapshot => this.snapshot;

  async init(): Promise<void> {
    try {
      this.update({ ready: true, stamps: await this.api.listStamps() });
    } catch (e) {
      this.update({ ready: true, stamps: [], error: errorMessage(e) });
    }
  }

  meta(id: string): StampMeta | undefined {
    return this.snapshot.stamps.find((s) => s.id === id);
  }

  /** 読み込み済みの画像。未読込なら読み込みを始めて undefined を返す (読み込めたら version が進む)。 */
  image(id: string): CanvasImageSource | undefined {
    const img = this.images.get(id);
    if (img || this.requested.has(id) || !this.meta(id)) return img;
    this.requested.add(id);
    this.api
      .loadStampImage(id)
      .then(this.loadImage)
      .then((loaded) => {
        this.images.set(id, loaded);
        this.update({});
      })
      .catch(() => {});
    return undefined;
  }

  async importImage(name: string, pngBase64: string, style: StampStyle): Promise<StampMeta> {
    const meta = await this.api.importStamp(name, pngBase64, style);
    this.update({ stamps: [...this.snapshot.stamps.filter((s) => s.id !== meta.id), meta] });
    return meta;
  }

  async remove(id: string): Promise<void> {
    await this.api.deleteStamp(id);
    this.images.delete(id);
    this.requested.delete(id);
    this.update({ stamps: this.snapshot.stamps.filter((s) => s.id !== id) });
  }

  private update(patch: Partial<UserAssetsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, version: this.snapshot.version + 1 };
    this.listeners.forEach((l) => l());
  }
}
