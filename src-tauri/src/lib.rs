pub mod diary;
pub mod ipc;
pub mod kofu;
pub mod stamps;

use tauri::Manager;

use diary::DiaryStore;
use stamps::{StampLibrary, stamp_root};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 日記・スタンプ画像はリポジトリの外 (OS のアプリ用データフォルダ) に保存する
            let data = app.path().app_data_dir()?;
            app.manage(DiaryStore::new(data.join("diaries")));
            app.manage(StampLibrary::new(stamp_root(&data)));
            Ok(())
        });
    ipc::register(builder)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
