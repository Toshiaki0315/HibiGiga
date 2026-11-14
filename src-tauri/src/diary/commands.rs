//! 日記のTauriコマンド。ロジックは `DiaryStore` に委譲する薄いラッパー。

use tauri::State;

use super::{DiaryEntry, DiaryError, DiaryStore};

#[tauri::command]
pub fn save_diary(
    store: State<'_, DiaryStore>,
    entry: DiaryEntry,
) -> Result<DiaryEntry, DiaryError> {
    store.save(entry)
}

#[tauri::command]
pub fn load_diary(
    store: State<'_, DiaryStore>,
    date: String,
) -> Result<Option<DiaryEntry>, DiaryError> {
    store.load(&date)
}

#[tauri::command]
pub fn list_diary_dates(store: State<'_, DiaryStore>) -> Result<Vec<String>, DiaryError> {
    store.list_dates()
}

#[cfg(test)]
mod tests {
    use crate::ipc::test_util::{harness, invoke};
    use serde_json::{Value, json};

    // R9: IPC越しの保存→読込→一覧
    #[test]
    fn r9_save_load_list_over_ipc() {
        let h = harness();
        let saved = invoke(
            &h,
            "save_diary",
            json!({ "entry": { "date": "2026-11-15", "text": "晩酌", "canvas": { "stamps": [] } } }),
        )
        .expect("save_diary should succeed");
        assert_eq!(saved["date"], "2026-11-15");
        assert!(
            saved["updatedAt"].is_string(),
            "updatedAt should be camelCase string: {saved}"
        );

        let loaded = invoke(&h, "load_diary", json!({ "date": "2026-11-15" })).unwrap();
        assert_eq!(loaded, saved);

        let dates = invoke(&h, "list_diary_dates", json!({})).unwrap();
        assert_eq!(dates, json!(["2026-11-15"]));
    }

    #[test]
    fn r9_load_missing_over_ipc_returns_null() {
        let h = harness();
        assert_eq!(
            invoke(&h, "load_diary", json!({ "date": "2026-01-01" })),
            Ok(Value::Null)
        );
    }

    #[test]
    fn r9_invalid_date_over_ipc_returns_structured_error() {
        let h = harness();
        let err = invoke(&h, "load_diary", json!({ "date": "../etc/passwd" })).unwrap_err();
        assert_eq!(err["kind"], "invalidDate");

        let err = invoke(
            &h,
            "save_diary",
            json!({ "entry": { "date": "2026-02-30", "text": "" } }),
        )
        .unwrap_err();
        assert_eq!(err["kind"], "invalidDate");
    }

    #[test]
    fn r9_canvas_defaults_to_null_when_omitted() {
        let h = harness();
        let saved = invoke(
            &h,
            "save_diary",
            json!({ "entry": { "date": "2026-11-15", "text": "x" } }),
        )
        .unwrap();
        assert_eq!(saved["canvas"], Value::Null);
    }
}
