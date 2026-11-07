//! Shared path permission: which relative paths are refused (`PathPolicy`) and the folder every path must stay inside (`Sandbox`).

use std::fs;
use std::path::{Path, PathBuf};

/// Strategy: decides which relative paths ("a/b.txt") are refused.
pub trait PathPolicy: Sync {
    fn refuses(&self, relative: &str) -> bool;
}

/// For the AI and automatic flows: secrets, keys, repo internals and dependencies are refused.
pub struct Guarded;

impl PathPolicy for Guarded {
    fn refuses(&self, relative: &str) -> bool {
        crate::workspace::denied(relative)
    }
}

/// For the viewer: the person may open any file of the project; only the sandbox bounds it.
pub struct Unguarded;

impl PathPolicy for Unguarded {
    fn refuses(&self, _relative: &str) -> bool {
        false
    }
}

/// A folder (stored as its real path) that resolved paths must not leave.
#[derive(Debug, Clone)]
pub struct Sandbox {
    root: PathBuf,
}

impl Sandbox {
    /// Opens a folder; `None` when it does not exist or is not a directory.
    pub fn open(path: &Path) -> Option<Self> {
        let root = fs::canonicalize(path).ok()?;

        root.is_dir().then_some(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Whether an already resolved (real) path lies inside the folder.
    pub fn contains(&self, resolved: &Path) -> bool {
        resolved.starts_with(&self.root)
    }

    /// Real path of an existing entry, or `None` when it is missing or links out of the folder.
    pub fn resolve(&self, path: &Path) -> Option<PathBuf> {
        let resolved = fs::canonicalize(path).ok()?;

        self.contains(&resolved).then_some(resolved)
    }

    /// Path of a resolved entry relative to the folder, with `/` separators (empty when outside).
    pub fn relative(&self, resolved: &Path) -> String {
        resolved
            .strip_prefix(&self.root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    }
}

#[cfg(test)]
#[path = "../tests/unit/permission.rs"]
mod tests;
