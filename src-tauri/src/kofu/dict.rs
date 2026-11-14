//! 語句の辞書による置き換え。

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::{Captures, Regex};

/// (現代語, 古風な言い方)。言い回し (活用形込み) も語として登録する。
/// 置き換え結果が他の見出しや文末規則に再度掛からないよう選ぶこと (二重変換の防止)。
pub const ENTRIES: &[(&str, &str)] = &[
    ("仕事が忙しかった", "職務多忙を極めたり"),
    ("忙しかった", "多忙を極めたり"),
    ("忙しい", "多忙なり"),
    ("疲れた", "疲弊せり"),
    ("起きた", "起床せり"),
    ("寝る", "床に就く"),
    ("ありがとう", "かたじけなし"),
    ("満員電車", "人いきれの車"),
    ("電車", "鉄の車"),
    ("今日", "本日"),
    ("今夜", "今宵"),
    ("仕事", "職務"),
    ("会社", "勤め先"),
    ("上司", "御上"),
    ("お酒", "美酒"),
    ("ご飯", "御膳"),
    ("とても", "いと"),
    ("すごく", "いたく"),
    ("たくさん", "あまた"),
    ("スマホ", "文の板"),
    ("パソコン", "電子の算盤"),
];

struct Dict {
    pattern: Regex,
    map: HashMap<&'static str, &'static str>,
}

static DICT: LazyLock<Dict> = LazyLock::new(|| {
    let mut keys: Vec<&str> = ENTRIES.iter().map(|(k, _)| *k).collect();
    // 同じ位置では先に書いた選択肢が勝つので、長い見出しを先に並べる
    keys.sort_by_key(|k| std::cmp::Reverse(k.chars().count()));
    let alternation = keys
        .iter()
        .map(|k| regex::escape(k))
        .collect::<Vec<_>>()
        .join("|");
    Dict {
        pattern: Regex::new(&alternation).unwrap(),
        map: ENTRIES.iter().copied().collect(),
    }
});

/// 辞書で置き換える (同じ位置では長い語句を優先し、置き換え結果は再度置き換えない)。
pub fn apply(text: &str) -> String {
    DICT.pattern
        .replace_all(text, |c: &Captures| DICT.map[&c[0]])
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // K2
    #[test]
    fn k2_dictionary_table() {
        for (from, to) in [
            ("今日", "本日"),
            ("今夜", "今宵"),
            ("仕事", "職務"),
            ("会社", "勤め先"),
            ("上司", "御上"),
            ("お酒", "美酒"),
            ("とても", "いと"),
            ("たくさん", "あまた"),
            ("疲れた", "疲弊せり"),
            ("忙しかった", "多忙を極めたり"),
            ("忙しい", "多忙なり"),
            ("ありがとう", "かたじけなし"),
            ("電車", "鉄の車"),
            ("スマホ", "文の板"),
        ] {
            assert_eq!(apply(from), to, "{from}");
        }
    }

    #[test]
    fn k2_prefers_the_longest_phrase() {
        assert_eq!(apply("満員電車"), "人いきれの車");
        assert_eq!(apply("仕事が忙しかった"), "職務多忙を極めたり");
        assert_eq!(apply("仕事が終わった"), "職務が終わった");
    }

    #[test]
    fn k2_replaces_every_occurrence_in_context() {
        assert_eq!(apply("今日も今日とて"), "本日も本日とて");
    }
}
