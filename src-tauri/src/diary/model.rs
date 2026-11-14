use serde::{Deserialize, Serialize};

/// 1日分の日記。ファイル `<root>/<date>.json` として保存される。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntry {
    /// `YYYY-MM-DD` 形式の日付
    pub date: String,
    /// 日記本文
    pub text: String,
    /// キャンバス状態 (スタンプ・筆跡など)。形式は後続フェーズで定義する。
    #[serde(default)]
    pub canvas: serde_json::Value,
    /// 最終更新日時 (RFC3339)。保存時にバックエンドが設定する。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}
