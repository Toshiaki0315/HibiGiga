use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use chrono::NaiveDate;

use super::{DiaryEntry, DiaryError};

pub type Result<T> = std::result::Result<T, DiaryError>;

/// 日付文字列が `YYYY-MM-DD` 形式の実在する日付か検証する。
/// ファイル名に直接使うため、パストラバーサル対策も兼ねる。
pub fn validate_date(date: &str) -> Result<()> {
    let b = date.as_bytes();
    // chrono は "+2026" 等も受理するため、先にASCII形式を厳密チェックする
    let well_formed = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        });
    if well_formed && NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok() {
        Ok(())
    } else {
        Err(DiaryError::InvalidDate(date.to_owned()))
    }
}

const EXT: &str = ".json";

/// ファイルシステム上の日記ストア。`root` 直下に `<date>.json` を置く。
#[derive(Debug, Clone)]
pub struct DiaryStore {
    root: PathBuf,
}

impl DiaryStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// 日記を保存し、`updated_at` を設定した保存後のエントリを返す。
    pub fn save(&self, mut entry: DiaryEntry) -> Result<DiaryEntry> {
        validate_date(&entry.date)?;
        fs::create_dir_all(&self.root)?;
        entry.updated_at = Some(chrono::Local::now().to_rfc3339());

        let bytes = serde_json::to_vec_pretty(&entry).map_err(std::io::Error::from)?;
        // 書き込み途中のクラッシュで日記が壊れないよう、一時ファイル経由で置き換える
        let path = self.path_for(&entry.date);
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, bytes)?;
        if let Err(e) = fs::rename(&tmp, &path) {
            let _ = fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(entry)
    }

    /// 指定日の日記を読み込む。存在しなければ `None`。
    pub fn load(&self, date: &str) -> Result<Option<DiaryEntry>> {
        validate_date(date)?;
        let bytes = match fs::read(self.path_for(date)) {
            Ok(b) => b,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| DiaryError::Corrupted(format!("{date}{EXT}: {e}")))
    }

    /// 保存済みの日付一覧を昇順で返す。
    pub fn list_dates(&self) -> Result<Vec<String>> {
        let entries = match fs::read_dir(&self.root) {
            Ok(it) => it,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut dates: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                let date = name.strip_suffix(EXT)?;
                validate_date(date).ok().map(|_| date.to_owned())
            })
            .collect();
        dates.sort();
        Ok(dates)
    }

    fn path_for(&self, date: &str) -> PathBuf {
        self.root.join(format!("{date}{EXT}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    fn store() -> (TempDir, DiaryStore) {
        let dir = TempDir::new().unwrap();
        let store = DiaryStore::new(dir.path().join("diaries"));
        (dir, store)
    }

    fn entry(date: &str, text: &str) -> DiaryEntry {
        DiaryEntry {
            date: date.into(),
            text: text.into(),
            canvas: json!({ "stamps": [{ "kind": "frog", "x": 10, "y": 20 }] }),
            updated_at: None,
        }
    }

    // R1: 保存→読込で同じ内容が返る
    #[test]
    fn r1_save_then_load_round_trips() {
        let (_d, s) = store();
        let saved = s
            .save(entry("2026-11-15", "今日も仕事が忙しかった"))
            .unwrap();
        let loaded = s.load("2026-11-15").unwrap().expect("entry should exist");
        assert_eq!(loaded, saved);
        assert_eq!(loaded.text, "今日も仕事が忙しかった");
        assert_eq!(loaded.canvas["stamps"][0]["kind"], "frog");
    }

    #[test]
    fn r1_save_sets_rfc3339_updated_at() {
        let (_d, s) = store();
        let saved = s.save(entry("2026-11-15", "x")).unwrap();
        let ts = saved.updated_at.expect("updated_at should be set");
        assert!(
            chrono::DateTime::parse_from_rfc3339(&ts).is_ok(),
            "not RFC3339: {ts}"
        );
    }

    // R2: 存在しない日付は Ok(None)
    #[test]
    fn r2_load_missing_returns_none() {
        let (_d, s) = store();
        assert_eq!(s.load("2026-01-01").unwrap(), None);
    }

    // R3: 同じ日付への再保存は上書き
    #[test]
    fn r3_save_overwrites_same_date() {
        let (_d, s) = store();
        s.save(entry("2026-11-15", "一回目")).unwrap();
        s.save(entry("2026-11-15", "二回目")).unwrap();
        assert_eq!(s.load("2026-11-15").unwrap().unwrap().text, "二回目");
        assert_eq!(s.list_dates().unwrap(), vec!["2026-11-15"]);
    }

    // R4: 不正な日付は InvalidDate (パストラバーサル含む)
    #[test]
    fn r4_invalid_dates_are_rejected() {
        let bad = [
            "",
            "2026-13-01",
            "2026-02-30",
            "2026-1-01",
            "20261115",
            "2026-11-15 ",
            "../etc/passwd",
            "2026-11-15/../../x",
            "..\\2026-11-15",
            "+2026-11-15",
            "２０２６-11-15",
        ];
        for d in bad {
            assert!(
                matches!(validate_date(d), Err(DiaryError::InvalidDate(ref s)) if s == d),
                "should reject {d:?}"
            );
        }
    }

    #[test]
    fn r4_valid_dates_are_accepted() {
        for d in ["2026-11-15", "2024-02-29", "1999-12-31"] {
            assert!(validate_date(d).is_ok(), "should accept {d:?}");
        }
    }

    #[test]
    fn r4_save_and_load_reject_invalid_date_without_touching_fs() {
        let (dir, s) = store();
        assert!(matches!(
            s.save(entry("../evil", "x")),
            Err(DiaryError::InvalidDate(_))
        ));
        assert!(matches!(s.load("../evil"), Err(DiaryError::InvalidDate(_))));
        assert!(!dir.path().join("diaries").exists());
        assert!(!dir.path().join("evil.json").exists());
    }

    // R5: 保存先ディレクトリが無ければ自動作成
    #[test]
    fn r5_save_creates_missing_root_dir() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("a").join("b").join("diaries");
        let s = DiaryStore::new(&root);
        s.save(entry("2026-11-15", "x")).unwrap();
        assert!(root.join("2026-11-15.json").is_file());
    }

    #[test]
    fn r5_save_leaves_no_temp_files() {
        let (dir, s) = store();
        s.save(entry("2026-11-15", "x")).unwrap();
        let names: Vec<_> = fs::read_dir(dir.path().join("diaries"))
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, vec!["2026-11-15.json"]);
    }

    #[test]
    fn r5_save_fails_with_io_when_root_is_a_file() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("not_a_dir");
        fs::write(&root, "x").unwrap();
        let s = DiaryStore::new(&root);
        assert!(matches!(
            s.save(entry("2026-11-15", "x")),
            Err(DiaryError::Io(_))
        ));
    }

    // R6: 壊れたJSONは Corrupted
    #[test]
    fn r6_corrupted_json_returns_corrupted() {
        let (dir, s) = store();
        let root = dir.path().join("diaries");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("2026-11-15.json"), "{ not json").unwrap();
        assert!(matches!(
            s.load("2026-11-15"),
            Err(DiaryError::Corrupted(_))
        ));
    }

    #[test]
    fn r6_load_fails_with_io_when_path_is_a_directory() {
        let (dir, s) = store();
        fs::create_dir_all(dir.path().join("diaries").join("2026-11-15.json")).unwrap();
        assert!(matches!(s.load("2026-11-15"), Err(DiaryError::Io(_))));
    }

    // R7: 一覧は昇順、無関係なファイルは無視
    #[test]
    fn r7_list_dates_sorted_and_filtered() {
        let (dir, s) = store();
        for d in ["2026-11-15", "2025-01-01", "2026-03-03"] {
            s.save(entry(d, d)).unwrap();
        }
        let root = dir.path().join("diaries");
        fs::write(root.join("notes.txt"), "x").unwrap();
        fs::write(root.join("2026-11-16.txt"), "x").unwrap();
        fs::write(root.join("2026-13-01.json"), "{}").unwrap();
        fs::write(root.join(".DS_Store"), "x").unwrap();
        fs::create_dir(root.join("2026-12-01.json.d")).unwrap();
        assert_eq!(
            s.list_dates().unwrap(),
            vec!["2025-01-01", "2026-03-03", "2026-11-15"]
        );
    }

    #[test]
    fn r7_list_dates_empty_when_root_missing() {
        let (_d, s) = store();
        assert_eq!(s.list_dates().unwrap(), Vec::<String>::new());
    }

    #[test]
    fn r7_list_dates_fails_with_io_when_root_is_a_file() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("file");
        fs::write(&root, "x").unwrap();
        assert!(matches!(
            DiaryStore::new(&root).list_dates(),
            Err(DiaryError::Io(_))
        ));
    }
}
