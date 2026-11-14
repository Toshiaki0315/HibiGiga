use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::StampError;

pub type Result<T> = std::result::Result<T, StampError>;

/// 取り込める画像の最大サイズ (バイト)
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
/// スタンプ名の最大文字数
pub const MAX_NAME_CHARS: usize = 40;

/// 描き方
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StampStyle {
    /// そのまま
    Original,
    /// 墨絵風 (白黒・高コントラストで和紙に重ねる)
    Ink,
}

/// 取り込んだスタンプの情報 (index.json に保存)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StampMeta {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub style: StampStyle,
    pub created_at: String,
}

/// スタンプ画像の保存先。アプリ用データフォルダ (リポジトリの外) の下の `stamps`。
pub fn stamp_root(app_data: &Path) -> PathBuf {
    app_data.join("stamps")
}

const INDEX: &str = "index.json";
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// PNG のシグネチャと IHDR を確かめ、縦横の大きさを返す
fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return Err(StampError::InvalidImage("not a PNG image".into()));
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0 || height == 0 {
        return Err(StampError::InvalidImage("PNG has zero size".into()));
    }
    Ok((width, height))
}

/// 小文字ハイフン区切りの UUID だけを受け付ける (ファイル名に使うためパストラバーサル対策を兼ねる)
fn validate_id(id: &str) -> Result<()> {
    match Uuid::parse_str(id) {
        Ok(u) if u.hyphenated().to_string() == id => Ok(()),
        _ => Err(StampError::InvalidId(id.to_owned())),
    }
}

/// 一時ファイルに書いてから置き換える
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })?;
    Ok(())
}

/// `root` 直下に `<uuid>.png` と `index.json` を置くスタンプ画像ライブラリ。
#[derive(Debug, Clone)]
pub struct StampLibrary {
    root: PathBuf,
}

impl StampLibrary {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// PNG を取り込む。名前は前後の空白を除いて 1〜40 文字。
    pub fn import(&self, name: &str, png: &[u8], style: StampStyle) -> Result<StampMeta> {
        let name = name.trim();
        let chars = name.chars().count();
        if chars == 0 || chars > MAX_NAME_CHARS {
            return Err(StampError::InvalidName);
        }
        if png.len() > MAX_BYTES {
            return Err(StampError::TooLarge { max: MAX_BYTES });
        }
        let (width, height) = png_dimensions(png)?;
        fs::create_dir_all(&self.root)?;
        let mut index = self.list()?;
        let meta = StampMeta {
            id: Uuid::new_v4().to_string(),
            name: name.to_owned(),
            width,
            height,
            style,
            created_at: chrono::Local::now().to_rfc3339(),
        };
        write_atomic(&self.image_path(&meta.id), png)?;
        index.push(meta.clone());
        self.write_index(&index)?;
        Ok(meta)
    }

    /// base64 の PNG を取り込む (IPC 用)。
    pub fn import_base64(&self, name: &str, b64: &str, style: StampStyle) -> Result<StampMeta> {
        let png = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| StampError::InvalidImage(format!("base64: {e}")))?;
        self.import(name, &png, style)
    }

    /// 取り込んだ順 (作成日時順) の一覧。index.json が無ければ空。
    pub fn list(&self) -> Result<Vec<StampMeta>> {
        let bytes = match fs::read(self.root.join(INDEX)) {
            Ok(b) => b,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        serde_json::from_slice(&bytes).map_err(|e| StampError::Corrupted(format!("{INDEX}: {e}")))
    }

    pub fn load(&self, id: &str) -> Result<Vec<u8>> {
        validate_id(id)?;
        fs::read(self.image_path(id)).map_err(|e| match e.kind() {
            ErrorKind::NotFound => StampError::NotFound(id.to_owned()),
            _ => e.into(),
        })
    }

    /// 一覧から外し、画像ファイルを消す (ファイルが既に無くてもよい)。
    pub fn delete(&self, id: &str) -> Result<()> {
        validate_id(id)?;
        let mut index = self.list()?;
        let before = index.len();
        index.retain(|m| m.id != id);
        if index.len() == before {
            return Err(StampError::NotFound(id.to_owned()));
        }
        self.write_index(&index)?;
        match fs::remove_file(self.image_path(id)) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    fn image_path(&self, id: &str) -> PathBuf {
        self.root.join(format!("{id}.png"))
    }

    fn write_index(&self, index: &[StampMeta]) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(index).map_err(std::io::Error::from)?;
        write_atomic(&self.root.join(INDEX), &bytes)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use base64::Engine;
    use std::fs;
    use tempfile::TempDir;

    /// シグネチャと IHDR を持つ最小の PNG 風データ
    pub(crate) fn png(w: u32, h: u32) -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&13u32.to_be_bytes());
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        v
    }

    fn lib() -> (TempDir, StampLibrary) {
        let dir = TempDir::new().unwrap();
        let lib = StampLibrary::new(dir.path().join("stamps"));
        (dir, lib)
    }

    // S1
    #[test]
    fn s1_import_saves_file_and_metadata() {
        let (dir, lib) = lib();
        let meta = lib
            .import("  猫の写真 ", &png(640, 480), StampStyle::Ink)
            .unwrap();
        assert_eq!(meta.name, "猫の写真");
        assert_eq!((meta.width, meta.height), (640, 480));
        assert_eq!(meta.style, StampStyle::Ink);
        assert!(uuid::Uuid::parse_str(&meta.id).is_ok());
        assert!(chrono::DateTime::parse_from_rfc3339(&meta.created_at).is_ok());
        let file = dir.path().join("stamps").join(format!("{}.png", meta.id));
        assert_eq!(fs::read(file).unwrap(), png(640, 480));
        assert_eq!(lib.list().unwrap(), vec![meta]);
    }

    #[test]
    fn s1_import_base64_decodes() {
        let (_d, lib) = lib();
        let b64 = base64::engine::general_purpose::STANDARD.encode(png(10, 20));
        let meta = lib.import_base64("a", &b64, StampStyle::Original).unwrap();
        assert_eq!((meta.width, meta.height), (10, 20));
    }

    // S2
    #[test]
    fn s2_rejects_bad_images_and_names() {
        let (dir, lib) = lib();
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert!(matches!(
            lib.import("a", &jpeg, StampStyle::Original),
            Err(StampError::InvalidImage(_))
        ));
        assert!(matches!(
            lib.import("a", &[], StampStyle::Original),
            Err(StampError::InvalidImage(_))
        ));
        let mut short = png(1, 1);
        short.truncate(20);
        assert!(matches!(
            lib.import("a", &short, StampStyle::Original),
            Err(StampError::InvalidImage(_))
        ));
        let mut no_ihdr = png(1, 1);
        no_ihdr[12..16].copy_from_slice(b"IDAT");
        assert!(matches!(
            lib.import("a", &no_ihdr, StampStyle::Original),
            Err(StampError::InvalidImage(_))
        ));
        assert!(matches!(
            lib.import("a", &png(0, 5), StampStyle::Original),
            Err(StampError::InvalidImage(_))
        ));
        let mut big = png(1, 1);
        big.resize(MAX_BYTES + 1, 0);
        assert!(matches!(
            lib.import("a", &big, StampStyle::Original),
            Err(StampError::TooLarge { .. })
        ));
        assert!(matches!(
            lib.import("  ", &png(1, 1), StampStyle::Original),
            Err(StampError::InvalidName)
        ));
        let long = "あ".repeat(MAX_NAME_CHARS + 1);
        assert!(matches!(
            lib.import(&long, &png(1, 1), StampStyle::Original),
            Err(StampError::InvalidName)
        ));
        assert!(
            lib.import(
                &"あ".repeat(MAX_NAME_CHARS),
                &png(1, 1),
                StampStyle::Original
            )
            .is_ok()
        );
        assert!(matches!(
            lib.import_base64("a", "***not base64***", StampStyle::Original),
            Err(StampError::InvalidImage(_))
        ));
        // 不正な取り込みでは画像ファイルを作らない (成功した1件分のみ)
        let pngs = fs::read_dir(dir.path().join("stamps"))
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|x| x == "png")
            })
            .count();
        assert_eq!(pngs, 1);
    }

    // S3
    #[test]
    fn s3_list_is_ordered_empty_when_missing_and_errors_when_corrupted() {
        let (dir, lib) = lib();
        assert_eq!(lib.list().unwrap(), vec![]);
        let a = lib.import("a", &png(1, 1), StampStyle::Original).unwrap();
        let b = lib.import("b", &png(2, 2), StampStyle::Ink).unwrap();
        assert_eq!(lib.list().unwrap(), vec![a, b]);
        fs::write(dir.path().join("stamps").join("index.json"), "{ broken").unwrap();
        assert!(matches!(lib.list(), Err(StampError::Corrupted(_))));
        assert!(matches!(
            lib.import("c", &png(1, 1), StampStyle::Original),
            Err(StampError::Corrupted(_))
        ));
    }

    #[test]
    fn s3_list_fails_with_io_when_index_is_a_directory() {
        let (dir, lib) = lib();
        fs::create_dir_all(dir.path().join("stamps").join("index.json")).unwrap();
        assert!(matches!(lib.list(), Err(StampError::Io(_))));
    }

    // S4
    #[test]
    fn s4_load_returns_bytes_and_validates_ids() {
        let (_d, lib) = lib();
        let meta = lib.import("a", &png(3, 4), StampStyle::Original).unwrap();
        assert_eq!(lib.load(&meta.id).unwrap(), png(3, 4));
        for bad in [
            "../index",
            "",
            "not-a-uuid",
            "{6a2f41a3-c54c-fce8-32d2-0324e1c32e22}",
        ] {
            assert!(
                matches!(lib.load(bad), Err(StampError::InvalidId(_))),
                "{bad}"
            );
        }
        let upper = meta.id.to_uppercase();
        assert!(matches!(lib.load(&upper), Err(StampError::InvalidId(_))));
        let missing = uuid::Uuid::new_v4().to_string();
        assert!(matches!(lib.load(&missing), Err(StampError::NotFound(_))));
    }

    #[test]
    fn s4_load_fails_with_io_when_path_is_a_directory() {
        let (dir, lib) = lib();
        let id = uuid::Uuid::new_v4().to_string();
        fs::create_dir_all(dir.path().join("stamps").join(format!("{id}.png"))).unwrap();
        assert!(matches!(lib.load(&id), Err(StampError::Io(_))));
    }

    // S5
    #[test]
    fn s5_delete_removes_file_and_entry() {
        let (dir, lib) = lib();
        let a = lib.import("a", &png(1, 1), StampStyle::Original).unwrap();
        let b = lib.import("b", &png(1, 1), StampStyle::Original).unwrap();
        lib.delete(&a.id).unwrap();
        assert_eq!(lib.list().unwrap(), vec![b]);
        assert!(
            !dir.path()
                .join("stamps")
                .join(format!("{}.png", a.id))
                .exists()
        );
        assert!(matches!(lib.delete(&a.id), Err(StampError::NotFound(_))));
        assert!(matches!(lib.delete("../x"), Err(StampError::InvalidId(_))));
    }

    #[test]
    fn s5_delete_tolerates_an_already_missing_file() {
        let (dir, lib) = lib();
        let a = lib.import("a", &png(1, 1), StampStyle::Original).unwrap();
        fs::remove_file(dir.path().join("stamps").join(format!("{}.png", a.id))).unwrap();
        lib.delete(&a.id).unwrap();
        assert_eq!(lib.list().unwrap(), vec![]);
    }

    // S6
    #[test]
    fn s6_leaves_no_temp_files_and_writes_only_under_root() {
        let (dir, lib) = lib();
        let a = lib.import("a", &png(1, 1), StampStyle::Original).unwrap();
        let mut names: Vec<_> = fs::read_dir(dir.path().join("stamps"))
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        let mut expected = vec![format!("{}.png", a.id), "index.json".to_string()];
        expected.sort();
        assert_eq!(names, expected);
        let top: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(top, vec![std::ffi::OsString::from("stamps")]);
    }

    #[test]
    fn s6_import_fails_with_io_when_root_is_a_file() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("file");
        fs::write(&root, "x").unwrap();
        let lib = StampLibrary::new(&root);
        assert!(matches!(
            lib.import("a", &png(1, 1), StampStyle::Original),
            Err(StampError::Io(_))
        ));
    }

    // S8
    #[test]
    fn s8_stamp_root_is_under_app_data() {
        assert_eq!(
            stamp_root(Path::new("/data/com.hibigiga.app")),
            PathBuf::from("/data/com.hibigiga.app/stamps")
        );
    }
}
