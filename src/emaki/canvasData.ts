import type { Stroke, StrokePoint } from "./stroke";

/** 絵巻に置いたスタンプ。x, y はその日の区画内のローカル座標で、スタンプの中心。 */
export interface Stamp {
  id: string;
  assetId: string;
  x: number;
  y: number;
  scale: number;
  /** ラジアン (時計回り) */
  rotation: number;
  flipX: boolean;
  /** 自由な文の吹き出し (assetId "phrase-custom") の文 */
  text?: string;
}

/** DiaryEntry.canvas に保存するキャンバスの状態 (version 2) */
export interface CanvasData {
  version: 2;
  strokes: Stroke[];
  stamps: Stamp[];
}

export class CanvasDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasDataError";
  }
}

export function emptyCanvas(): CanvasData {
  return { version: 2, strokes: [], stamps: [] };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function fail(message: string): never {
  throw new CanvasDataError(message);
}

function parsePoint(v: unknown): StrokePoint {
  if (!isObj(v) || ![v.x, v.y, v.p, v.t].every(isNum)) fail("invalid stroke point");
  return { x: v.x as number, y: v.y as number, p: v.p as number, t: v.t as number };
}

function parseStroke(v: unknown): Stroke {
  if (!isObj(v)) fail("stroke must be an object");
  if (typeof v.id !== "string" || typeof v.color !== "string") fail("invalid stroke id/color");
  if (![v.seed, v.size, v.bleed, v.dryness].every(isNum)) fail("invalid stroke numbers");
  if (!Array.isArray(v.points)) fail("stroke points must be an array");
  return {
    id: v.id,
    color: v.color,
    seed: v.seed as number,
    size: v.size as number,
    bleed: v.bleed as number,
    dryness: v.dryness as number,
    points: v.points.map(parsePoint),
  };
}

function parseStamp(v: unknown): Stamp {
  if (!isObj(v)) fail("stamp must be an object");
  if (typeof v.id !== "string" || typeof v.assetId !== "string") fail("invalid stamp id/assetId");
  if (![v.x, v.y, v.scale, v.rotation].every(isNum)) fail("invalid stamp numbers");
  if ((v.scale as number) <= 0) fail("stamp scale must be positive");
  if (typeof v.flipX !== "boolean") fail("invalid stamp flipX");
  if (v.text !== undefined && typeof v.text !== "string") fail("invalid stamp text");
  return {
    id: v.id,
    // 素材一覧に無い assetId も残す (表示時に代わりの絵を出す)
    assetId: v.assetId,
    x: v.x as number,
    y: v.y as number,
    scale: v.scale as number,
    rotation: v.rotation as number,
    flipX: v.flipX,
    ...(typeof v.text === "string" ? { text: v.text } : {}),
  };
}

/**
 * 保存データを検証して読み込む。version 1 は stamps を補って version 2 にする。null/undefined (優先度1で保存した日記) は空のキャンバス。
 * 不正なら CanvasDataError を投げる。
 */
export function parseCanvasData(raw: unknown): CanvasData {
  if (raw === null || raw === undefined) return emptyCanvas();
  if (!isObj(raw)) fail("canvas must be an object");
  if (raw.version !== 1 && raw.version !== 2) {
    fail(`unsupported canvas version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.strokes)) fail("strokes must be an array");
  const strokes = raw.strokes.map(parseStroke);
  if (raw.version === 1) return { version: 2, strokes, stamps: [] };
  if (!Array.isArray(raw.stamps)) fail("stamps must be an array");
  return { version: 2, strokes, stamps: raw.stamps.map(parseStamp) };
}
