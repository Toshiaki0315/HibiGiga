//! 取り込んだスタンプ画像の保存。
//!
//! 個人の写真を含みうるため、画像はリポジトリの外 (OS のアプリ用データフォルダ) にのみ保存する。
//! - `error`   : フロントへ返すエラー型
//! - `library` : ファイルシステムへの保存ロジック (Tauri非依存)
//! - `commands`: Tauriコマンド

pub mod commands;
pub mod error;
pub mod library;

pub use error::StampError;
pub use library::{StampLibrary, StampMeta, StampStyle, stamp_root};
