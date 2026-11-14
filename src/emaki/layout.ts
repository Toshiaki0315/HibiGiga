import { isValidDate } from "../api/diary";
import { clampScroll, type Direction, type Viewport } from "./viewport";

/** 日付ラベル (縦書き) を日の読み始め側の端からどれだけ離すか */
export const LABEL_MARGIN = 40;

/** 絵巻上の1日分の区画 (ワールド座標) */
export interface Segment {
  date: string;
  x: number;
  width: number;
  labelX: number;
}

export interface Layout {
  /** 日付の昇順 */
  segments: Segment[];
  contentWidth: number;
  dayWidth: number;
  direction: Direction;
}

export interface LayoutOptions {
  dayWidth: number;
  direction: Direction;
}

/** 日付の一覧から絵巻のレイアウトを作る。日記の無い日は詰めて並べる。 */
export function buildLayout(dates: string[], { dayWidth, direction }: LayoutOptions): Layout {
  const sorted = [...new Set(dates.filter(isValidDate))].sort();
  const n = sorted.length;
  const segments = sorted.map((date, i) => {
    const x = (direction === "rtl" ? n - 1 - i : i) * dayWidth;
    const labelX = direction === "rtl" ? x + dayWidth - LABEL_MARGIN : x + LABEL_MARGIN;
    return { date, x, width: dayWidth, labelX };
  });
  return { segments, contentWidth: n * dayWidth, dayWidth, direction };
}

/** 画面 (と前後の buffer) に掛かっている区画を x 昇順で返す */
export function visibleSegments(l: Layout, vp: Viewport, buffer = 0): Segment[] {
  const left = vp.scrollX - buffer;
  const right = vp.scrollX + vp.width + buffer;
  return l.segments.filter((s) => s.x < right && s.x + s.width > left).sort((a, b) => a.x - b.x);
}

/** ワールド x がどの日のどの位置かを返す (区画は [x, x+width) の半開区間) */
export function locate(l: Layout, worldX: number): { segment: Segment; localX: number } | null {
  const segment = l.segments.find((s) => worldX >= s.x && worldX < s.x + s.width);
  return segment ? { segment, localX: worldX - segment.x } : null;
}

/**
 * 指定日を映す scrollX。未知の日付なら null。
 * 日が画面より狭ければ中央に、広ければ読み始め側 (日付ラベルのある端) を映す。
 */
export function scrollToDate(l: Layout, date: string, viewportWidth: number): number | null {
  const s = l.segments.find((seg) => seg.date === date);
  if (!s) return null;
  const target =
    s.width <= viewportWidth
      ? s.x + s.width / 2 - viewportWidth / 2
      : l.direction === "rtl"
        ? s.x + s.width - viewportWidth
        : s.x;
  return clampScroll(target, viewportWidth, l.contentWidth);
}
