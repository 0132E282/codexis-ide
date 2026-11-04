//! Images and files pasted into the chat box. A pasted item has no path on disk, so it is written into the app cache folder and the chat sends that path to the CLI as `@path`, like a picked file.

use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

/// Largest pasted item.
pub const MAX_BYTES: usize = 25 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentError {
    Empty,
    TooLarge,
    SaveFailed,
}

impl AttachmentError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "Tệp trống.",
            Self::TooLarge => "Tệp quá lớn (tối đa 25 MB).",
            Self::SaveFailed => "Không lưu được tệp đính kèm.",
        }
    }
}

impl fmt::Display for AttachmentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for AttachmentError {}

/// Writes `data` into `dir` and returns its path. The file name is the first bytes of the content hash plus a safe form of `name` (letters, digits, `.`, `_`, `-`), so the same content pasted twice is one file and a name can never leave `dir`.
///
/// # Errors
/// Fails on empty or oversized data, or when the folder or file cannot be written.
pub fn save(dir: &Path, name: &str, data: &[u8]) -> Result<PathBuf, AttachmentError> {
    if data.is_empty() {
        return Err(AttachmentError::Empty);
    }

    if data.len() > MAX_BYTES {
        return Err(AttachmentError::TooLarge);
    }

    let hash = Sha256::digest(data);
    let prefix: String = hash
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let path = dir.join(format!("{prefix}-{}", safe_name(name)));

    fs::create_dir_all(dir).map_err(|_| AttachmentError::SaveFailed)?;
    fs::write(&path, data).map_err(|_| AttachmentError::SaveFailed)?;

    Ok(path)
}

/// Reads back a file saved by [`save`]; only a file that lies inside `dir` can be read, so this never serves another file of the machine.
///
/// # Errors
/// Fails when the path is outside `dir`, is not a file, is too large, or cannot be read.
pub fn read(dir: &Path, path: &Path) -> Result<Vec<u8>, AttachmentError> {
    let dir = dir
        .canonicalize()
        .map_err(|_| AttachmentError::SaveFailed)?;
    let path = path
        .canonicalize()
        .map_err(|_| AttachmentError::SaveFailed)?;

    if !path.starts_with(&dir) || !path.is_file() {
        return Err(AttachmentError::SaveFailed);
    }

    let metadata = fs::metadata(&path).map_err(|_| AttachmentError::SaveFailed)?;

    if metadata.len() > MAX_BYTES as u64 {
        return Err(AttachmentError::TooLarge);
    }

    fs::read(path).map_err(|_| AttachmentError::SaveFailed)
}

/// Only the last path segment, reduced to safe characters; `file` when nothing is left.
fn safe_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(MAX_NAME_CHARS)
        .collect();
    let cleaned = cleaned.trim_start_matches('.');

    if cleaned.is_empty() {
        "file".to_string()
    } else {
        cleaned.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_files_inside_the_folder_can_be_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let path = save(dir.path(), "a.png", b"png").unwrap();
        let other = outside.path().join("secret.txt");

        fs::write(&other, b"secret").unwrap();

        assert_eq!(read(dir.path(), &path).unwrap(), b"png");
        assert!(read(dir.path(), &other).is_err());
        assert!(read(dir.path(), &dir.path().join("../x")).is_err());
    }

    #[test]
    fn saved_file_has_the_content_and_stays_inside_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = save(dir.path(), "../../etc/passwd", b"hello").unwrap();

        assert_eq!(path.parent().unwrap(), dir.path());
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("-passwd"));
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn same_content_and_name_is_one_file() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(
            save(dir.path(), "image.png", b"x").unwrap(),
            save(dir.path(), "image.png", b"x").unwrap()
        );
        assert_ne!(
            save(dir.path(), "image.png", b"x").unwrap(),
            save(dir.path(), "image.png", b"y").unwrap()
        );
    }

    #[test]
    fn odd_names_are_made_safe() {
        assert_eq!(safe_name("Ảnh chụp màn hình.png"), "_nh_ch_p_m_n_h_nh.png");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name(""), "file");
        assert_eq!(safe_name("a\\b\\c.txt"), "c.txt");
        assert!(safe_name(&"x".repeat(500)).chars().count() <= MAX_NAME_CHARS);
    }

    #[test]
    fn empty_and_oversized_data_are_refused() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(save(dir.path(), "a", b""), Err(AttachmentError::Empty));
        assert_eq!(
            save(dir.path(), "a", &vec![0; MAX_BYTES + 1]),
            Err(AttachmentError::TooLarge)
        );
    }
}
