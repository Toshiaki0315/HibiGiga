//! スタンプ画像の Tauri コマンド。

use base64::Engine;
use tauri::State;

use super::{StampError, StampLibrary, StampMeta, StampStyle};

/// PNG (base64) を取り込む。フロントで縮小・再エンコード済み (EXIF 除去済み) の画像を受け取る。
#[tauri::command]
pub fn import_stamp(
    library: State<'_, StampLibrary>,
    name: String,
    png_base64: String,
    style: StampStyle,
) -> Result<StampMeta, StampError> {
    library.import_base64(&name, &png_base64, style)
}

#[tauri::command]
pub fn list_stamps(library: State<'_, StampLibrary>) -> Result<Vec<StampMeta>, StampError> {
    library.list()
}

/// 画像を base64 で返す
#[tauri::command]
pub fn load_stamp_image(
    library: State<'_, StampLibrary>,
    id: String,
) -> Result<String, StampError> {
    let bytes = library.load(&id)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn delete_stamp(library: State<'_, StampLibrary>, id: String) -> Result<(), StampError> {
    library.delete(&id)
}

#[cfg(test)]
mod tests {
    use crate::ipc::test_util::{harness, invoke};
    use crate::stamps::library::tests::png;
    use base64::Engine;
    use serde_json::{Value, json};

    // S7
    #[test]
    fn s7_import_list_load_delete_over_ipc() {
        let h = harness();
        let b64 = base64::engine::general_purpose::STANDARD.encode(png(32, 16));
        let meta = invoke(
            &h,
            "import_stamp",
            json!({ "name": "猫", "pngBase64": b64, "style": "ink" }),
        )
        .expect("import_stamp should succeed");
        assert_eq!(meta["name"], "猫");
        assert_eq!(meta["width"], 32);
        assert_eq!(meta["style"], "ink");
        assert!(meta["createdAt"].is_string());
        let id = meta["id"].as_str().unwrap().to_string();

        assert_eq!(invoke(&h, "list_stamps", json!({})), Ok(json!([meta])));
        assert_eq!(
            invoke(&h, "load_stamp_image", json!({ "id": id })),
            Ok(Value::String(b64))
        );
        assert_eq!(
            invoke(&h, "delete_stamp", json!({ "id": id })),
            Ok(Value::Null)
        );
        assert_eq!(invoke(&h, "list_stamps", json!({})), Ok(json!([])));
    }

    #[test]
    fn s7_errors_are_structured() {
        let h = harness();
        let err = invoke(&h, "load_stamp_image", json!({ "id": "../x" })).unwrap_err();
        assert_eq!(err["kind"], "invalidId");
        let err = invoke(
            &h,
            "import_stamp",
            json!({ "name": "a", "pngBase64": "AAAA", "style": "original" }),
        )
        .unwrap_err();
        assert_eq!(err["kind"], "invalidImage");
    }
}
