//! フロントエンドから呼べる Tauri コマンドの登録。

use tauri::{Builder, Runtime};

/// 全コマンドを Builder に登録する。本番 (`lib::run`) とテストで共通に使う。
pub fn register<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        crate::diary::commands::save_diary,
        crate::diary::commands::load_diary,
        crate::diary::commands::list_diary_dates,
        crate::kofu::commands::convert_kofu,
        crate::stamps::commands::import_stamp,
        crate::stamps::commands::list_stamps,
        crate::stamps::commands::load_stamp_image,
        crate::stamps::commands::delete_stamp,
    ])
}

/// テスト用: モックアプリを立てて IPC 越しにコマンドを呼ぶ
#[cfg(test)]
pub mod test_util {
    use serde_json::Value;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{
        INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
    };
    use tauri::webview::InvokeRequest;
    use tauri::{App, WebviewWindow, WebviewWindowBuilder};
    use tempfile::TempDir;

    use crate::diary::DiaryStore;
    use crate::stamps::{StampLibrary, stamp_root};

    pub struct Harness {
        _dir: TempDir,
        _app: App<MockRuntime>,
        webview: WebviewWindow<MockRuntime>,
    }

    pub fn harness() -> Harness {
        let dir = TempDir::new().unwrap();
        let app = super::register(
            mock_builder()
                .manage(DiaryStore::new(dir.path().join("diaries")))
                .manage(StampLibrary::new(stamp_root(dir.path()))),
        )
        .build(mock_context(noop_assets()))
        .expect("failed to build mock app");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        Harness {
            _dir: dir,
            _app: app,
            webview,
        }
    }

    pub fn invoke(h: &Harness, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            &h.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|b| b.deserialize::<Value>().unwrap())
    }
}
