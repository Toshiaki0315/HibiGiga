import { isValidDate } from "../api/diary";

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1〜99 の整数を漢数字にする (例: 21 → 二十一) */
export function toKanjiNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new RangeError(`unsupported number: ${n}`);
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPart = tens === 0 ? "" : tens === 1 ? "十" : `${DIGITS[tens]}十`;
  return tensPart + DIGITS[ones];
}

/** `YYYY-MM-DD` を絵巻の日付ラベル (例: 十一月十五日) にする */
export function toKanjiDate(date: string): string {
  if (!isValidDate(date)) throw new RangeError(`invalid date: ${JSON.stringify(date)}`);
  const [, m, d] = date.split("-").map(Number);
  return `${toKanjiNumber(m)}月${toKanjiNumber(d)}日`;
}
