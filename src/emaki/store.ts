import {
  errorMessage,
  isValidDate,
  listDiaryDates,
  loadDiary,
  saveDiary,
  type DiaryEntry,
} from "../api/diary";
import { parseCanvasData, type CanvasData, type Stamp } from "./canvasData";
import type { Stroke } from "./stroke";

export interface DiaryApi {
  listDiaryDates(): Promise<string[]>;
  loadDiary(date: string): Promise<DiaryEntry | null>;
  saveDiary(entry: DiaryEntry): Promise<DiaryEntry>;
}

export const defaultApi: DiaryApi = { listDiaryDates, loadDiary, saveDiary };

interface Saved {
  updatedAt?: string;
  saveError?: string;
}

/** 1日分の読み込み・編集状態 */
export type DayState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready"; text: string; canvas: CanvasData } & Saved)
  /** キャンバスが壊れている日。本文は読み書きできるが、描画は不可で元データを保持する。 */
  | ({ status: "canvasError"; text: string; rawCanvas: unknown; message: string } & Saved);

type EditableDay = Extract<DayState, { text: string }>;

export interface EmakiSnapshot {
  /** init 完了済みか */
  ready: boolean;
  /** 絵巻に並べる日付 (昇順) */
  dates: string[];
  days: Record<string, DayState>;
  error?: string;
  history: HistoryState;
}

/** 元に戻す／やり直しの状態。undoDate / redoDate は次に戻す／やり直す編集の日付。 */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoDate?: string;
  redoDate?: string;
}

/** 1回の編集の前後 (キャンバスは不変データなので、変わっていない部分は共有される) */
interface HistoryEntry {
  date: string;
  before: CanvasData;
  after: CanvasData;
}

/** 元に戻せる編集の最大数 */
export const HISTORY_LIMIT = 100;

const isEditable = (d: DayState | undefined): d is EditableDay =>
  d?.status === "ready" || d?.status === "canvasError";

/**
 * 絵巻全体の日記データを持つストア。
 * 見えている日だけ遅延読み込みし、筆跡と本文の保存を日付ごとに直列化する。
 * React からは useSyncExternalStore で購読する。
 */
export class EmakiStore {
  private snapshot: EmakiSnapshot = {
    ready: false,
    dates: [],
    days: {},
    history: { canUndo: false, canRedo: false },
  };
  private listeners = new Set<() => void>();
  private inflight = new Map<string, Promise<void>>();
  private queues = new Map<string, Promise<void>>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(
    private readonly api: DiaryApi,
    private readonly today: string,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EmakiSnapshot => this.snapshot;

  async init(): Promise<void> {
    let saved: string[] = [];
    let error: string | undefined;
    try {
      saved = await this.api.listDiaryDates();
    } catch (e) {
      error = errorMessage(e);
    }
    const dates = [...new Set([...this.snapshot.dates, ...saved, this.today])].sort();
    this.update({ ...this.snapshot, ready: true, dates, ...(error ? { error } : {}) });
  }

  /** 指定日の日記を (未読込なら) 読み込む。同時要求は1回にまとめる。 */
  async ensureLoaded(dates: string[]): Promise<void> {
    const pending = [...new Set(dates)].map((date) => {
      const running = this.inflight.get(date);
      if (running) return running;
      const day = this.snapshot.days[date];
      if (day && day.status !== "error") return Promise.resolve();
      const p = this.load(date).finally(() => this.inflight.delete(date));
      this.inflight.set(date, p);
      return p;
    });
    await Promise.all(pending);
  }

  /** 筆跡を追加して保存する。保存失敗は saveError として記録する (筆跡は残す)。 */
  async addStroke(date: string, stroke: Stroke): Promise<void> {
    await this.editCanvas(date, (c) => ({ ...c, strokes: [...c.strokes, stroke] }));
  }

  /** スタンプを置いて保存する (失敗は saveError として記録) */
  async addStamp(date: string, stamp: Stamp): Promise<void> {
    await this.editCanvas(date, (c) => ({ ...c, stamps: [...c.stamps, stamp] }));
  }

  /** スタンプの位置・大きさ・向き等を変更して保存する */
  async updateStamp(date: string, id: string, patch: Partial<Omit<Stamp, "id">>): Promise<void> {
    await this.editCanvas(date, (c) => ({
      ...c,
      stamps: c.stamps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }), id);
  }

  async removeStamp(date: string, id: string): Promise<void> {
    await this.editCanvas(date, (c) => ({ ...c, stamps: c.stamps.filter((s) => s.id !== id) }), id);
  }

  /**
   * 描画可能な日のキャンバスを編集し、保存を予約する。
   * stampId を渡した場合、そのスタンプが無ければ reject する。保存失敗は saveError に記録する。
   */
  private async editCanvas(
    date: string,
    edit: (c: CanvasData) => CanvasData,
    stampId?: string,
  ): Promise<void> {
    const day = this.snapshot.days[date];
    if (day?.status !== "ready") throw new Error(`day ${date} is not drawable`);
    if (stampId !== undefined && !day.canvas.stamps.some((s) => s.id === stampId)) {
      throw new Error(`no stamp ${stampId} on ${date}`);
    }
    const before = day.canvas;
    const after = edit(before);
    this.undoStack.push({ date, before, after });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.setDay(date, { ...day, canvas: after });
    await this.enqueueSave(date).catch(() => {});
  }

  /** 直前のキャンバス編集を取り消して保存する (本文の編集は対象外) */
  async undo(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(entry);
    await this.applyCanvas(entry.date, entry.before);
  }

  /** 取り消した編集をやり直して保存する */
  async redo(): Promise<void> {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry);
    await this.applyCanvas(entry.date, entry.after);
  }

  /** 履歴のキャンバスを書き戻す。履歴に載る日は描画可能な日だけなので ready が保証される。 */
  private async applyCanvas(date: string, canvas: CanvasData): Promise<void> {
    const day = this.snapshot.days[date] as Extract<DayState, { status: "ready" }>;
    this.setDay(date, { ...day, canvas });
    await this.enqueueSave(date).catch(() => {});
  }

  /** 本文を更新して保存する。失敗時は reject する。 */
  async saveText(date: string, text: string): Promise<void> {
    const day = this.snapshot.days[date];
    if (!isEditable(day)) throw new Error(`day ${date} is not loaded`);
    this.setDay(date, { ...day, text });
    await this.enqueueSave(date);
  }

  /** 絵巻に日付を加える (未保存の日を表示・編集するため) */
  addDate(date: string): void {
    if (!isValidDate(date) || this.snapshot.dates.includes(date)) return;
    this.update({ ...this.snapshot, dates: [...this.snapshot.dates, date].sort() });
  }

  private async load(date: string): Promise<void> {
    this.setDay(date, { status: "loading" });
    let entry: DiaryEntry | null;
    try {
      entry = await this.api.loadDiary(date);
    } catch (e) {
      this.setDay(date, { status: "error", message: errorMessage(e) });
      return;
    }
    const text = entry?.text ?? "";
    const saved: Saved = entry?.updatedAt ? { updatedAt: entry.updatedAt } : {};
    try {
      this.setDay(date, { status: "ready", text, canvas: parseCanvasData(entry?.canvas), ...saved });
    } catch (e) {
      // parseCanvasData は CanvasDataError のみ投げる
      this.setDay(date, { status: "canvasError", text, rawCanvas: entry?.canvas, message: errorMessage(e), ...saved });
    }
  }

  /** 日付ごとに保存を直列化する。実行時点の最新状態を送る。 */
  private enqueueSave(date: string): Promise<void> {
    const prev = this.queues.get(date) ?? Promise.resolve();
    const next = prev.then(() => this.save(date));
    this.queues.set(
      date,
      next.catch(() => {}),
    );
    return next;
  }

  private async save(date: string): Promise<void> {
    const day = this.snapshot.days[date] as EditableDay;
    const canvas = day.status === "ready" ? day.canvas : day.rawCanvas;
    try {
      const saved = await this.api.saveDiary({ date, text: day.text, canvas });
      const { saveError: _drop, ...current } = this.snapshot.days[date] as EditableDay;
      this.setDay(date, { ...current, ...(saved.updatedAt ? { updatedAt: saved.updatedAt } : {}) });
    } catch (e) {
      const message = errorMessage(e);
      this.setDay(date, { ...(this.snapshot.days[date] as EditableDay), saveError: message });
      throw e;
    }
  }

  private historyState(): HistoryState {
    const u = this.undoStack.at(-1);
    const r = this.redoStack.at(-1);
    return {
      canUndo: u !== undefined,
      canRedo: r !== undefined,
      ...(u ? { undoDate: u.date } : {}),
      ...(r ? { redoDate: r.date } : {}),
    };
  }

  private setDay(date: string, state: DayState): void {
    this.update({ ...this.snapshot, days: { ...this.snapshot.days, [date]: state } });
  }

  private update(next: EmakiSnapshot): void {
    this.snapshot = { ...next, history: this.historyState() };
    this.listeners.forEach((l) => l());
  }
}
