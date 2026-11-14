//! 日記のセーブ/ロード機能。
//!
//! - `model`   : IPCでやり取りするデータ型
//! - `error`   : フロントへ返すエラー型
//! - `store`   : ファイルシステムへの永続化ロジック (Tauri非依存)
//! - `commands`: Tauriコマンド (storeへの薄いラッパー)

pub mod commands;
pub mod error;
pub mod model;
pub mod store;

pub use error::DiaryError;
pub use model::DiaryEntry;
pub use store::DiaryStore;
