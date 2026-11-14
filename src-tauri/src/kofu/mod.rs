//! 自動「古風」日記変換。
//!
//! 現代語の日記を、規則 (辞書 + 正規表現) で古語・古典調の文に変換する。
//! 1. 数字を漢数字に (`numerals`)
//! 2. 語句の辞書で置き換え、長い語句を優先 (`dict`)
//! 3. 文末を古語の形に (`endings`)

pub mod commands;
pub mod dict;
pub mod endings;
pub mod numerals;

/// 現代語の文を古風な文に変換する。
pub fn convert(text: &str) -> String {
    endings::apply(&dict::apply(&numerals::apply(text)))
}

#[cfg(test)]
mod tests {
    use super::*;

    // K5: 仕様書・README の例文
    #[test]
    fn k5_spec_examples() {
        assert_eq!(
            convert("今日も1日疲れた。お酒を飲もう。"),
            "本日も一日疲弊せり。美酒を飲まん。"
        );
        assert_eq!(
            convert("今日も仕事が忙しかった"),
            "本日も職務多忙を極めたり"
        );
    }

    // K4: 複数文・改行・句読点・変換対象なし・空文字
    #[test]
    fn k4_multiple_sentences_and_newlines() {
        assert_eq!(convert("今日は雨だ。\n寒い。"), "本日は雨なり。\n寒し。");
        assert_eq!(convert("行かない、食べた！"), "行かず、食べたり！");
    }

    #[test]
    fn k4_leaves_unmatched_text_and_empty_input() {
        assert_eq!(convert("こんにちは"), "こんにちは");
        assert_eq!(convert(""), "");
    }

    // K6: 二重に変換されない
    #[test]
    fn k6_is_idempotent() {
        let corpus = [
            "今日も1日疲れた。お酒を飲もう。",
            "今日も仕事が忙しかった",
            "満員電車で会社に行きました。上司が厳しい。",
            "楽しかった。帰りたい。明日は休みです。",
            "雨だった。寝ている。しない。行かなかった。",
            "ありがとう。食べよう。でしょう。2026年11月15日",
        ];
        for text in corpus {
            let once = convert(text);
            assert_eq!(
                convert(&once),
                once,
                "not idempotent for {text:?} → {once:?}"
            );
        }
    }
}
