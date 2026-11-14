//! 古風変換の Tauri コマンド。

/// 日記の文を古風な文に変換して返す (保存はしない)。
#[tauri::command]
pub fn convert_kofu(text: String) -> String {
    super::convert(&text)
}

#[cfg(test)]
mod tests {
    use crate::ipc::test_util::{harness, invoke};
    use serde_json::json;

    // K7: IPC 越しに変換結果が返る
    #[test]
    fn k7_convert_kofu_over_ipc() {
        let h = harness();
        assert_eq!(
            invoke(&h, "convert_kofu", json!({ "text": "今日も1日疲れた。" })),
            Ok(json!("本日も一日疲弊せり。"))
        );
        assert_eq!(
            invoke(&h, "convert_kofu", json!({ "text": "" })),
            Ok(json!(""))
        );
    }
}
