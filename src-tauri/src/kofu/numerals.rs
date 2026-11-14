//! 数字 (半角・全角) を漢数字にする。

use std::sync::LazyLock;

use regex::{Captures, Regex};

const DIGITS: [&str; 10] = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

static DIGIT_RUN: LazyLock<Regex> = LazyLock::new(|| Regex::new("[0-9０-９]+").unwrap());

/// 位の数字 (1 は省く) と位の字をつなげる。例: (2, "十") → 二十、(1, "百") → 百
fn place(d: usize, unit: &str) -> String {
    match d {
        0 => String::new(),
        1 => unit.to_owned(),
        _ => format!("{}{unit}", DIGITS[d]),
    }
}

/// ASCII 数字の並びを漢数字にする。1000 未満は位取り (二十三、百五)、
/// それ以上や先頭が 0 の並びは1字ずつ (二〇二六、〇〇七)。
pub fn to_kanji(n: &str) -> String {
    let digits: Vec<usize> = n.bytes().map(|b| (b - b'0') as usize).collect();
    if digits.len() > 3 || (digits.len() > 1 && digits[0] == 0) {
        return digits.iter().map(|&d| DIGITS[d]).collect();
    }
    let value = digits.iter().fold(0, |acc, d| acc * 10 + d);
    if value == 0 {
        return DIGITS[0].to_owned();
    }
    let (h, t, o) = (value / 100, value / 10 % 10, value % 10);
    let ones = if o == 0 { "" } else { DIGITS[o] };
    format!("{}{}{ones}", place(h, "百"), place(t, "十"))
}

/// 文中の数字の並び (全角を含む) をすべて漢数字にする。
pub fn apply(text: &str) -> String {
    DIGIT_RUN
        .replace_all(text, |c: &Captures| {
            let ascii: String = c[0]
                .chars()
                .map(|ch| {
                    char::from_digit(
                        ch.to_digit(10).unwrap_or_else(|| ch as u32 - '０' as u32),
                        10,
                    )
                    .unwrap()
                })
                .collect();
            to_kanji(&ascii)
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // K1
    #[test]
    fn k1_positional_below_one_thousand() {
        for (n, k) in [
            ("0", "〇"),
            ("1", "一"),
            ("9", "九"),
            ("10", "十"),
            ("11", "十一"),
            ("20", "二十"),
            ("23", "二十三"),
            ("100", "百"),
            ("105", "百五"),
            ("110", "百十"),
            ("230", "二百三十"),
            ("999", "九百九十九"),
        ] {
            assert_eq!(to_kanji(n), k, "{n}");
        }
    }

    #[test]
    fn k1_digit_by_digit_from_one_thousand_and_with_leading_zeros() {
        assert_eq!(to_kanji("2026"), "二〇二六");
        assert_eq!(to_kanji("12345"), "一二三四五");
        assert_eq!(to_kanji("007"), "〇〇七");
    }

    #[test]
    fn k1_apply_replaces_half_and_full_width_digit_runs() {
        assert_eq!(apply("1日に3回"), "一日に三回");
        assert_eq!(apply("２０２６年１１月"), "二〇二六年十一月");
        assert_eq!(apply("数字なし"), "数字なし");
    }
}
