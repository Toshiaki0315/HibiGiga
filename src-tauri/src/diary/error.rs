use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// 日記操作のエラー。
#[derive(Debug, thiserror::Error)]
pub enum DiaryError {
    #[error("invalid date: {0:?}")]
    InvalidDate(String),
    #[error("corrupted diary file: {0}")]
    Corrupted(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl DiaryError {
    /// フロントエンドで分岐に使う識別子
    pub fn kind(&self) -> &'static str {
        match self {
            Self::InvalidDate(_) => "invalidDate",
            Self::Corrupted(_) => "corrupted",
            Self::Io(_) => "io",
        }
    }
}

impl Serialize for DiaryError {
    /// IPCでは `{ "kind": "...", "message": "..." }` として返す
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("DiaryError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // R8: エラーは {kind, message} 形式のJSONとしてIPCで返る
    #[test]
    fn r8_invalid_date_serializes_to_kind_and_message() {
        let err = DiaryError::InvalidDate("2026-13-01".into());
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            json!({ "kind": "invalidDate", "message": "invalid date: \"2026-13-01\"" })
        );
    }

    #[test]
    fn r8_corrupted_serializes_with_corrupted_kind() {
        let err = DiaryError::Corrupted("2026-11-15.json".into());
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "corrupted");
        assert_eq!(v["message"], "corrupted diary file: 2026-11-15.json");
    }

    #[test]
    fn r8_io_error_serializes_with_io_kind() {
        let err: DiaryError = std::io::Error::other("disk full").into();
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "io");
        assert_eq!(v["message"], "io error: disk full");
    }
}
