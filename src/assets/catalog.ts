/**
 * 素材 (アセット) ライブラリ。
 * 鳥獣戯画の画風を参考に、本プロジェクトで一から描き起こした線画データのみを収録する
 * (既存の絵巻の画像・トレースは使用しない)。線は筆エンジンで描くため、にじみ・かすれが付く。
 */
import type { BrushSettings } from "../emaki/stroke";

export type AssetCategory = "animal" | "item" | "phrase";
/** 素材の枠内の座標と筆圧 */
export type AssetPoint = [x: number, y: number, p: number];

/** 線画の素材 */
export interface InkAsset {
  id: string;
  category: "animal" | "item";
  name: string;
  width: number;
  height: number;
  brush: BrushSettings;
  lines: AssetPoint[][];
}

/** 古典調の吹き出し (縦書き) */
export interface PhraseAsset {
  id: string;
  category: "phrase";
  name: string;
  text: string;
  width: number;
  height: number;
  /** ライブラリに並べない (自由な文の吹き出し用) */
  hidden?: boolean;
}

export type AssetDef = InkAsset | PhraseAsset;

export const CATEGORIES: { id: AssetCategory; label: string }[] = [
  { id: "animal", label: "動物" },
  { id: "item", label: "道具" },
  { id: "phrase", label: "吹き出し" },
];

type XY = [number, number];
const round = (v: number) => Math.round(v * 10) / 10;

/** 筆の入り・抜きのように、両端を細く中央を太くした筆圧を付ける (2点以上) */
function ink(pts: XY[]): AssetPoint[] {
  return pts.map(([x, y], i) => {
    const u = i / (pts.length - 1);
    return [round(x), round(y), round(0.35 + 0.55 * Math.sin(Math.PI * u))];
  });
}

/** 楕円弧 (角度は度。0=右、90=下) */
function arc(cx: number, cy: number, rx: number, ry: number, from = 0, to = 360, n = 18): AssetPoint[] {
  const pts: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return ink(pts);
}

/** 直線の折れ線。なめらか処理で角が膨らまないよう、各辺に点を補う */
const SEGMENT_STEP = 5;
function line(...pts: XY[]): AssetPoint[] {
  const dense: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SEGMENT_STEP));
    for (let k = 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return ink(dense);
}

const ANIMAL_BRUSH: BrushSettings = { size: 4, bleed: 0.15, dryness: 0.25 };
const ITEM_BRUSH: BrushSettings = { size: 3, bleed: 0.05, dryness: 0.1 };

/** 杯 (さかずき) */
const cup = (x: number, y: number) => line([x, y], [x + 14, y], [x + 10, y + 8], [x + 4, y + 8], [x, y]);

const ANIMALS: InkAsset[] = [
  {
    id: "frog-run",
    category: "animal",
    name: "カエル（走る）",
    width: 120,
    height: 120,
    brush: ANIMAL_BRUSH,
    lines: [
      arc(55, 62, 26, 20, 200, 520),
      arc(80, 45, 16, 13),
      arc(86, 38, 4, 4, 0, 360, 10),
      line([88, 50], [95, 50]),
      line([72, 62], [90, 70], [100, 64]),
      line([45, 55], [30, 45], [22, 50]),
      line([60, 80], [75, 98], [92, 100]),
      line([45, 78], [30, 95], [14, 104]),
    ],
  },
  {
    id: "frog-drink",
    category: "animal",
    name: "カエル（お酒を飲む）",
    width: 120,
    height: 120,
    brush: ANIMAL_BRUSH,
    lines: [
      arc(55, 72, 28, 26),
      arc(60, 40, 18, 14),
      arc(52, 32, 4, 4, 0, 360, 10),
      arc(68, 32, 4, 4, 0, 360, 10),
      line([70, 68], [84, 58], [88, 50]),
      cup(82, 42),
      line([40, 68], [30, 80]),
      line([40, 96], [28, 108], [44, 110]),
      line([70, 96], [82, 108], [66, 110]),
      line([100, 76], [100, 84]),
      arc(100, 96, 9, 12),
    ],
  },
  {
    id: "rabbit-run",
    category: "animal",
    name: "ウサギ（走る）",
    width: 120,
    height: 120,
    brush: ANIMAL_BRUSH,
    lines: [
      arc(55, 65, 24, 16, 190, 530),
      arc(82, 48, 12, 10),
      line([78, 40], [70, 12], [76, 10], [84, 38]),
      line([84, 40], [88, 14], [94, 16], [90, 40]),
      arc(86, 46, 2.5, 2.5, 0, 360, 8),
      line([70, 76], [88, 86], [98, 84]),
      line([40, 74], [24, 90], [10, 92]),
      arc(31, 60, 4, 4, 0, 360, 10),
    ],
  },
  {
    id: "rabbit-drink",
    category: "animal",
    name: "ウサギ（お酒を飲む）",
    width: 120,
    height: 120,
    brush: ANIMAL_BRUSH,
    lines: [
      arc(55, 78, 22, 26),
      arc(58, 44, 13, 11),
      line([52, 34], [46, 8], [52, 6], [56, 33]),
      line([62, 34], [66, 8], [72, 10], [64, 34]),
      arc(62, 42, 2, 2, 0, 360, 8),
      line([68, 70], [80, 58], [80, 50]),
      cup(74, 42),
      line([45, 102], [36, 112], [50, 113]),
      line([65, 102], [74, 112], [60, 113]),
    ],
  },
  {
    id: "monkey-run",
    category: "animal",
    name: "猿（走る）",
    width: 120,
    height: 120,
    brush: ANIMAL_BRUSH,
    lines: [
      arc(55, 62, 18, 22),
      arc(74, 32, 13, 13),
      arc(78, 34, 7, 8),
      arc(62, 28, 4, 4, 0, 360, 10),
      line([62, 50], [84, 60], [96, 52]),
      line([50, 50], [34, 40], [26, 46]),
      line([52, 82], [68, 98], [84, 100]),
      line([50, 82], [36, 98], [20, 104]),
      line([38, 70], [22, 62], [16, 46], [24, 38]),
    ],
  },
  {
    id: "monkey-drink",
    category: "animal",
    name: "猿（お酒を飲む）",
    width: 120,
    height: 120,
    brush: ANIMAL_BRUSH,
    lines: [
      arc(55, 78, 22, 24),
      arc(56, 40, 14, 14),
      arc(58, 43, 8, 9),
      arc(42, 40, 4, 4, 0, 360, 10),
      arc(70, 40, 4, 4, 0, 360, 10),
      line([70, 72], [82, 60], [84, 52]),
      cup(78, 44),
      line([44, 100], [36, 112], [50, 112]),
      line([66, 100], [74, 112], [60, 112]),
      line([36, 92], [18, 96], [12, 82]),
    ],
  },
];

const ITEMS: InkAsset[] = [
  {
    id: "laptop",
    category: "item",
    name: "ノートPC",
    width: 120,
    height: 90,
    brush: ITEM_BRUSH,
    lines: [
      line([25, 10], [95, 10], [95, 55], [25, 55], [25, 10]),
      line([31, 16], [89, 16], [89, 49], [31, 49], [31, 16]),
      line([20, 60], [100, 60], [110, 78], [10, 78], [20, 60]),
      line([45, 70], [75, 70]),
    ],
  },
  {
    id: "smartphone",
    category: "item",
    name: "スマートフォン",
    width: 70,
    height: 120,
    brush: ITEM_BRUSH,
    lines: [
      arc(23, 18, 8, 8, 180, 270, 6),
      line([23, 10], [47, 10]),
      arc(47, 18, 8, 8, 270, 360, 6),
      line([55, 18], [55, 102]),
      arc(47, 102, 8, 8, 0, 90, 6),
      line([47, 110], [23, 110]),
      arc(23, 102, 8, 8, 90, 180, 6),
      line([15, 102], [15, 18]),
      line([20, 22], [50, 22], [50, 94], [20, 94], [20, 22]),
      arc(35, 102, 3, 3, 0, 360, 8),
    ],
  },
  {
    id: "bicycle",
    category: "item",
    name: "自転車",
    width: 140,
    height: 90,
    brush: ITEM_BRUSH,
    lines: [
      arc(32, 62, 22, 22, 0, 360, 24),
      arc(108, 62, 22, 22, 0, 360, 24),
      line([32, 62], [60, 62], [84, 34], [52, 34], [32, 62]),
      line([60, 62], [48, 28]),
      line([42, 26], [56, 26]),
      line([84, 34], [108, 62]),
      line([80, 24], [90, 22], [84, 34]),
    ],
  },
];

const PHRASE_FONT = 20;
const phrase = (id: string, text: string): PhraseAsset => ({
  id,
  category: "phrase",
  name: `吹き出し「${text}」`,
  text,
  width: 56,
  height: text.length * PHRASE_FONT + 40,
});

/** 吹き出しの縦書き文字の大きさ */
export const PHRASE_FONT_SIZE = PHRASE_FONT;

/** 古風変換の結果など、自由な文の吹き出し (文はスタンプ側に持つ) */
const CUSTOM_PHRASE: PhraseAsset = {
  id: "phrase-custom",
  category: "phrase",
  name: "吹き出し（自由な文）",
  text: "",
  width: 56,
  height: 60,
  hidden: true,
};

const PHRASES: PhraseAsset[] = [
  phrase("phrase-koreha", "これはいかに"),
  phrase("phrase-ottotto", "おっとっと"),
  CUSTOM_PHRASE,
];

export const ASSETS: AssetDef[] = [...ANIMALS, ...ITEMS, ...PHRASES];

const byId = new Map(ASSETS.map((a) => [a.id, a]));

export function assetsIn(category: AssetCategory): AssetDef[] {
  return ASSETS.filter((a) => a.category === category && !(a.category === "phrase" && a.hidden));
}

export function findAsset(id: string): AssetDef | undefined {
  return byId.get(id);
}
