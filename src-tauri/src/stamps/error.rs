use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// スタンプ画像操作のエラー。
#[derive(Debug, thiserror::Error)]
pub enum StampError {
    #[error("invalid stamp id: {0:?}")]
    InvalidId(String),
    #[error("stamp name must be 1-40 characters")]
    InvalidName,
    #[error("invalid image: {0}")]
    InvalidImage(String),
    #[error("image is too large (max {max} bytes)")]
    TooLarge { max: usize },
    #[error("stamp not found: {0}")]
    NotFound(String),
    #[error("corrupted stamp index: {0}")]
    Corrupted(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl StampError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::InvalidId(_) => "invalidId",
            Self::InvalidName => "invalidName",
            Self::InvalidImage(_) => "invalidImage",
            Self::TooLarge { .. } => "tooLarge",
            Self::NotFound(_) => "notFound",
            Self::Corrupted(_) => "corrupted",
            Self::Io(_) => "io",
        }
    }
}

impl Serialize for StampError {
    /// IPCでは `{ "kind": "...", "message": "..." }` として返す
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("StampError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_every_kind_with_message() {
        let cases: Vec<(StampError, &str)> = vec![
            (StampError::InvalidId("x".into()), "invalidId"),
            (StampError::InvalidName, "invalidName"),
            (StampError::InvalidImage("not png".into()), "invalidImage"),
            (StampError::TooLarge { max: 8 }, "tooLarge"),
            (StampError::NotFound("a".into()), "notFound"),
            (StampError::Corrupted("index.json".into()), "corrupted"),
            (std::io::Error::other("disk").into(), "io"),
        ];
        for (err, kind) in cases {
            let v = serde_json::to_value(&err).unwrap();
            assert_eq!(v["kind"], kind);
            assert_eq!(v["message"], err.to_string());
        }
    }
}
