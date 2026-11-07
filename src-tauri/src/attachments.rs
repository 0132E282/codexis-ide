//! Images and files pasted into the chat box. A pasted item has no path on disk, so it is written into the app cache folder and the chat sends that path to the CLI as `@path`, like a picked file.

use crate::permission::Sandbox;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

/// Largest pasted item.
pub const MAX_BYTES: usize = 25 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 80;
/// Bytes of the content hash in the file name (16 hex characters).
const HASH_BYTES: usize = 8;
/// Longest raw name looked at before it is reduced to safe characters.
pub const MAX_RAW_NAME_BYTES: usize = 1024;

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
            Self::Empty => "attachments.empty",
            Self::TooLarge => "attachments.too_large",
            Self::SaveFailed => "attachments.save_failed",
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
        .take(HASH_BYTES)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let path = dir.join(format!("{prefix}-{}", safe_name(name)));

    fs::create_dir_all(dir).map_err(|_| AttachmentError::SaveFailed)?;

    // * A symlink planted at the target would send the write elsewhere: refuse it.
    if fs::symlink_metadata(&path).is_ok_and(|metadata| !metadata.is_file()) {
        return Err(AttachmentError::SaveFailed);
    }

    fs::write(&path, data).map_err(|_| AttachmentError::SaveFailed)?;

    Ok(path)
}

/// Reads back a file saved by [`save`]; only a file that lies inside `dir` can be read, so this never serves another file of the machine.
///
/// # Errors
/// Fails when the path is outside `dir`, is not a file, is too large, or cannot be read.
pub fn read(dir: &Path, path: &Path) -> Result<Vec<u8>, AttachmentError> {
    let sandbox = Sandbox::open(dir).ok_or(AttachmentError::SaveFailed)?;
    let path = sandbox.resolve(path).ok_or(AttachmentError::SaveFailed)?;

    if !path.is_file() {
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
    let stem = cleaned.split('.').next().unwrap_or_default();

    if cleaned.is_empty() || is_device_name(stem) {
        "file".to_string()
    } else {
        cleaned.to_string()
    }
}

/// Windows device names (`CON`, `NUL`, `COM1`...), which cannot be file names there.
fn is_device_name(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();

    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|number| matches!(number.as_bytes(), [b'1'..=b'9']))
}

#[cfg(test)]
#[path = "../tests/unit/attachments.rs"]
mod tests;
