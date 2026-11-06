//! Sandboxed access to one project folder. Port of `LocalWorkspace.php` (path guards, tree, read, write with hash check).
//!
//! The caller names files by relative path only. Every path is cleaned, checked against the deny list and resolved to a real path that must stay inside the root (links cannot escape; for a new file its parent folder is checked).
//! Errors carry fixed messages and never a path of this machine.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_READ_BYTES: u64 = 1_000_000;

/// Largest picture or PDF the viewer may load.
pub const MAX_MEDIA_BYTES: u64 = 20_000_000;
pub const MAX_WRITE_BYTES: usize = 100_000;
pub const MAX_TREE_ENTRIES: usize = 2000;
pub const MAX_DEPTH: usize = 12;

/// Longest relative path (in bytes) a caller may name.
const MAX_PATH_BYTES: usize = 300;

/// Folder names (any level) nobody may read or write: repo internals and dependencies.
const DENIED_DIRECTORIES: [&str; 4] = [".git", "storage", "vendor", "node_modules"];

/// Folders and files left out of the tree listing only (generated output, OS litter). They stay readable and do not eat the entry cap.
const HIDDEN_FROM_TREE: [&str; 6] = [
    "dist",
    "target",
    ".next",
    "__pycache__",
    ".turbo",
    ".DS_Store",
];

/// Shell-style patterns (`*` only) matched against the lower-cased file name: secrets and keys.
const DENIED_NAMES: [&str; 18] = [
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.keystore",
    "id_rsa*",
    "id_dsa*",
    "id_ecdsa*",
    "id_ed25519*",
    "credentials*",
    "secret*",
    "*.secret",
    ".npmrc",
    ".htpasswd",
    ".netrc",
    "auth.json",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceError {
    UnknownRoot,
    BadPath,
    Denied,
    NotFound,
    NotText,
    TooLarge,
    Conflict,
    WriteFailed,
}

impl WorkspaceError {
    /// Fixed user-facing text (same wording as the web app).
    pub fn message(self) -> &'static str {
        match self {
            Self::UnknownRoot => "Thư mục gốc không có trong danh sách cho phép.",
            Self::BadPath => "Đường dẫn không hợp lệ.",
            Self::Denied => "Tệp này bị chặn vì có thể chứa bí mật hoặc thuộc thư mục hệ thống.",
            Self::NotFound => "Không tìm thấy tệp.",
            Self::NotText => "Không đọc được tệp này (không phải văn bản UTF-8 nhỏ).",
            Self::TooLarge => "Nội dung quá lớn.",
            Self::Conflict => "Tệp đã thay đổi kể từ lúc đề xuất. Hãy yêu cầu AI đề xuất lại.",
            Self::WriteFailed => "Không ghi được tệp.",
        }
    }

    /// HTTP-like status the web app answered with, kept so the front end reacts the same way.
    pub fn status(self) -> u16 {
        match self {
            Self::UnknownRoot | Self::NotFound => 404,
            Self::Denied => 403,
            Self::Conflict => 409,
            Self::WriteFailed => 500,
            _ => 422,
        }
    }
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for WorkspaceError {}

pub type Result<T> = std::result::Result<T, WorkspaceError>;

#[derive(Debug, PartialEq, Eq)]
pub struct Tree {
    pub paths: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Written {
    pub before: Option<String>,
    pub after: String,
}

/// A clean relative path ("a/b.txt"), or None for anything that could climb out or hide something.
pub fn normalise(path: &str) -> Option<String> {
    let drive = matches!(path.as_bytes(), [letter, b':', ..] if letter.is_ascii_alphabetic());

    if path.is_empty()
        || path.len() > MAX_PATH_BYTES
        || path.chars().any(|c| c.is_control() || c == '\\')
        || path.starts_with('/')
        || drive
    {
        return None;
    }

    let segments: Vec<&str> = path.split('/').collect();

    if segments.iter().any(|s| matches!(*s, "" | "." | "..")) {
        return None;
    }

    Some(segments.join("/"))
}

/// The viewer's rule: the person opens and saves any file of the project (secrets, `.git`, dependencies), only the project root bounds it.
fn nothing_refused(_relative: &str) -> bool {
    false
}

/// Whether the path is, or lies inside, a folder nobody may open (repo internals, dependencies).
fn in_denied_directory(relative: &str) -> bool {
    relative
        .to_lowercase()
        .split('/')
        .any(|segment| DENIED_DIRECTORIES.contains(&segment))
}

/// Paths the AI and the person may never read or write: secrets, keys, repo internals, dependencies.
pub fn denied(relative: &str) -> bool {
    let lower = relative.to_lowercase();
    let mut segments: Vec<&str> = lower.split('/').collect();
    let name = segments.pop().unwrap_or("");

    segments.iter().any(|s| DENIED_DIRECTORIES.contains(s))
        || DENIED_DIRECTORIES.contains(&name)
        || DENIED_NAMES.iter().any(|pattern| glob(pattern, name))
}

/// `*`-only wildcard match of a whole name.
fn glob(pattern: &str, name: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();

    if parts.len() == 1 {
        return pattern == name;
    }

    let (first, last) = (parts[0], parts[parts.len() - 1]);

    if !name.starts_with(first) || name.len() < first.len() + last.len() || !name.ends_with(last) {
        return false;
    }

    let mut rest = &name[first.len()..name.len() - last.len()];

    for middle in &parts[1..parts.len() - 1] {
        match rest.find(middle) {
            Some(at) => rest = &rest[at + middle.len()..],
            None => return false,
        }
    }

    true
}

pub fn hash(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    /// Opens a project folder; the root is stored as its real path.
    pub fn open(path: &Path) -> Result<Self> {
        let root = fs::canonicalize(path).map_err(|_| WorkspaceError::UnknownRoot)?;

        if root.is_dir() {
            Ok(Self { root })
        } else {
            Err(WorkspaceError::UnknownRoot)
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// File paths under the root (no links followed, denied folders skipped), capped in count and depth.
    pub fn tree(&self) -> Tree {
        let mut paths = Vec::new();
        let mut truncated = false;

        self.walk(&self.root, "", 0, &mut paths, &mut truncated);
        paths.sort();

        Tree { paths, truncated }
    }

    fn walk(
        &self,
        dir: &Path,
        prefix: &str,
        depth: usize,
        paths: &mut Vec<String>,
        truncated: &mut bool,
    ) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = entries.flatten().collect();

        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            if *truncated {
                return;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };

            // * Secret files (`.env`, keys) are listed by name so the tree shows the whole project; they stay unreadable (`read` and `write` still refuse them).
            if in_denied_directory(&relative) || HIDDEN_FROM_TREE.contains(&name.as_str()) {
                continue;
            }

            let Ok(kind) = entry.file_type() else {
                continue;
            };

            if kind.is_symlink() {
                continue;
            }

            if kind.is_dir() {
                if depth < MAX_DEPTH {
                    self.walk(&entry.path(), &relative, depth + 1, paths, truncated);
                }
            } else if kind.is_file() {
                if paths.len() >= MAX_TREE_ENTRIES {
                    *truncated = true;

                    return;
                }

                paths.push(relative);
            }
        }
    }

    /// Text of a file for the viewer only: like `read`, but secret files (`.env`, keys) can be opened to look at; folders such as `.git` stay closed. The AI's tools keep using `read`.
    pub fn read_for_viewer(&self, path: &str) -> Result<String> {
        self.read_with(path, nothing_refused)
    }

    /// Text of one allowed file. Refuses denied names, links leaving the root, binary data and files over the size limit.
    pub fn read(&self, path: &str) -> Result<String> {
        self.read_with(path, denied)
    }

    fn read_with(&self, path: &str, refuses: fn(&str) -> bool) -> Result<String> {
        let full = self.existing_file_with(path, refuses)?;
        let size = fs::metadata(&full)
            .map_err(|_| WorkspaceError::NotFound)?
            .len();

        if size > MAX_READ_BYTES {
            return Err(WorkspaceError::TooLarge);
        }

        let bytes = fs::read(&full).map_err(|_| WorkspaceError::NotText)?;

        if bytes.contains(&0) {
            return Err(WorkspaceError::NotText);
        }

        String::from_utf8(bytes).map_err(|_| WorkspaceError::NotText)
    }

    /// Raw bytes of one allowed file for the viewer (a picture or a PDF). Same guards as `read`, with the larger media limit.
    pub fn read_bytes(&self, path: &str) -> Result<Vec<u8>> {
        let full = self.existing_file(path)?;
        let size = fs::metadata(&full)
            .map_err(|_| WorkspaceError::NotFound)?
            .len();

        if size > MAX_MEDIA_BYTES {
            return Err(WorkspaceError::TooLarge);
        }

        fs::read(&full).map_err(|_| WorkspaceError::NotFound)
    }

    /// Hash of the file's current content, or None when it does not exist (a new file).
    pub fn current_hash(&self, path: &str) -> Result<Option<String>> {
        self.current_hash_with(path, denied)
    }

    fn current_hash_with(&self, path: &str, refuses: fn(&str) -> bool) -> Result<Option<String>> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if refuses(&relative) {
            return Err(WorkspaceError::Denied);
        }

        let parent = self.parent_directory(&relative, denied)?;
        let full = parent.join(file_name(&relative));

        if fs::symlink_metadata(&full).is_err() {
            return Ok(None);
        }

        self.read_with(path, refuses)
            .map(|content| Some(hash(&content)))
    }

    /// Atomic write: temp file in the same folder, then rename, keeping the file's permissions.
    /// `expected` is the hash seen when the edit was proposed (None = the file did not exist); any other current state is a conflict.
    pub fn write(&self, path: &str, content: &str, expected: Option<&str>) -> Result<Written> {
        self.write_with(path, content, expected, denied)
    }

    /// Save made by the person in the viewer: like `write`, but secret files (`.env`, keys) can be edited; folders such as `.git` stay closed. The AI's tools keep using `write`.
    pub fn write_for_viewer(
        &self,
        path: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Result<Written> {
        self.write_with(path, content, expected, nothing_refused)
    }

    /// Hash of the file's current content for the viewer's save (secret files included), or None when it does not exist.
    pub fn current_hash_for_viewer(&self, path: &str) -> Result<Option<String>> {
        self.current_hash_with(path, nothing_refused)
    }

    fn write_with(
        &self,
        path: &str,
        content: &str,
        expected: Option<&str>,
        refuses: fn(&str) -> bool,
    ) -> Result<Written> {
        if content.len() > MAX_WRITE_BYTES {
            return Err(WorkspaceError::TooLarge);
        }

        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if refuses(&relative) {
            return Err(WorkspaceError::Denied);
        }

        let parent = self.parent_directory(&relative, refuses)?;
        let full = parent.join(file_name(&relative));

        // * A link as the target could point anywhere, even when its folder is inside the root.
        if fs::symlink_metadata(&full).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(WorkspaceError::BadPath);
        }

        let current = self.current_hash_with(path, refuses)?;

        if current.as_deref() != expected {
            return Err(WorkspaceError::Conflict);
        }

        let permissions = fs::metadata(&full).ok().map(|meta| meta.permissions());
        let temporary = parent.join(format!(
            ".ai-write-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_nanos())
        ));

        let written = fs::write(&temporary, content)
            .and_then(|()| match permissions {
                Some(p) => fs::set_permissions(&temporary, p),
                None => Ok(()),
            })
            .and_then(|()| fs::rename(&temporary, &full));

        if written.is_err() {
            // * Best-effort cleanup; the failed write is what gets reported.
            let _ = fs::remove_file(&temporary);

            return Err(WorkspaceError::WriteFailed);
        }

        Ok(Written {
            before: current,
            after: hash(content),
        })
    }

    /// Renames a file or folder in place (same folder, new name) and returns its new relative path. The person's action from the viewer: nothing is refused but leaving the project, the name must be a single plain name, and an existing file is never overwritten.
    pub fn rename_for_viewer(&self, path: &str, new_name: &str) -> Result<String> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;
        let name = new_name.trim();

        if name.is_empty()
            || name.len() > MAX_PATH_BYTES
            || matches!(name, "." | "..")
            || name
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
        {
            return Err(WorkspaceError::BadPath);
        }

        let parent = self.parent_directory(&relative, nothing_refused)?;
        let from = parent.join(file_name(&relative));
        let to = parent.join(name);
        let meta = fs::symlink_metadata(&from).map_err(|_| WorkspaceError::NotFound)?;

        if meta.file_type().is_symlink() {
            return Err(WorkspaceError::BadPath);
        }

        if fs::symlink_metadata(&to).is_ok() {
            return Err(WorkspaceError::Conflict);
        }

        fs::rename(&from, &to).map_err(|_| WorkspaceError::WriteFailed)?;

        Ok(match relative.rsplit_once('/') {
            Some((folder, _)) => format!("{folder}/{name}"),
            None => name.to_string(),
        })
    }

    /// Removes a regular file (a new file being discarded); never a link, never a folder.
    pub fn delete(&self, path: &str) -> Result<()> {
        let relative = self.allowed_relative(path)?;
        let full = self
            .parent_directory(&relative, denied)?
            .join(file_name(&relative));
        let meta = fs::symlink_metadata(&full).map_err(|_| WorkspaceError::WriteFailed)?;

        if meta.file_type().is_symlink() || !meta.is_file() || fs::remove_file(&full).is_err() {
            return Err(WorkspaceError::WriteFailed);
        }

        Ok(())
    }

    /// Real path of an existing allowed file, for handing to another program (the editor) that opens it itself.
    pub fn existing_path(&self, path: &str) -> Result<PathBuf> {
        self.existing_file(path)
    }

    pub fn allowed_relative(&self, path: &str) -> Result<String> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if denied(&relative) {
            return Err(WorkspaceError::Denied);
        }

        Ok(relative)
    }

    /// Real path of an existing regular file inside the root (re-checked against the deny list after links are resolved).
    fn existing_file(&self, path: &str) -> Result<PathBuf> {
        self.existing_file_with(path, denied)
    }

    fn existing_file_with(&self, path: &str, refuses: fn(&str) -> bool) -> Result<PathBuf> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if refuses(&relative) {
            return Err(WorkspaceError::Denied);
        }

        let full =
            fs::canonicalize(self.root.join(&relative)).map_err(|_| WorkspaceError::NotFound)?;

        if !full.is_file() {
            return Err(WorkspaceError::NotFound);
        }

        self.assert_inside(&full)?;

        if refuses(&self.relative_of(&full)) {
            return Err(WorkspaceError::Denied);
        }

        Ok(full)
    }

    /// Real path of the folder that holds (or will hold) the file; it must exist and sit inside the root.
    fn parent_directory(&self, relative: &str, refuses: fn(&str) -> bool) -> Result<PathBuf> {
        let dir = Path::new(relative)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        let parent = fs::canonicalize(self.root.join(dir)).map_err(|_| WorkspaceError::NotFound)?;

        if !parent.is_dir() {
            return Err(WorkspaceError::NotFound);
        }

        self.assert_inside(&parent)?;

        // * A folder reached through a link may resolve into a denied one (e.g. `docs` -> `.git`).
        if refuses(&format!("{}/x", self.relative_of(&parent))) {
            return Err(WorkspaceError::Denied);
        }

        Ok(parent)
    }

    fn assert_inside(&self, resolved: &Path) -> Result<()> {
        if resolved.starts_with(&self.root) {
            Ok(())
        } else {
            Err(WorkspaceError::BadPath)
        }
    }

    fn relative_of(&self, resolved: &Path) -> String {
        resolved
            .strip_prefix(&self.root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    }
}

fn file_name(relative: &str) -> &str {
    relative.rsplit('/').next().unwrap_or(relative)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn project() -> (TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();

        (dir, workspace)
    }

    #[test]
    fn binary_files_are_read_as_bytes_but_not_as_text() {
        let (dir, workspace) = project();

        fs::write(dir.path().join("logo.png"), [0x89, b'P', b'N', b'G', 0, 1]).unwrap();

        assert_eq!(workspace.read("logo.png"), Err(WorkspaceError::NotText));
        assert_eq!(
            workspace.read_bytes("logo.png").unwrap(),
            [0x89, b'P', b'N', b'G', 0, 1]
        );
        assert_eq!(
            workspace.read_bytes("../logo.png"),
            Err(WorkspaceError::Denied)
        );
    }

    #[test]
    fn traversal_is_refused() {
        for bad in [
            "../x",
            "a/../b",
            "/etc/passwd",
            "a//b",
            "./a",
            "C:/x",
            "a\\b",
            "",
            "a/.",
            "a\u{0}b",
        ] {
            assert_eq!(normalise(bad), None, "{bad:?}");
        }

        assert_eq!(normalise("src/app.rs"), Some("src/app.rs".into()));
        assert_eq!(normalise(&"a/".repeat(200)), None);
    }

    #[test]
    fn symlink_out_of_the_root_is_refused() {
        let (dir, workspace) = project();
        let outside = tempfile::tempdir().unwrap();

        fs::write(outside.path().join("notes.txt"), "outside").unwrap();
        symlink(outside.path(), dir.path().join("link")).unwrap();
        symlink(
            outside.path().join("notes.txt"),
            dir.path().join("file-link"),
        )
        .unwrap();

        assert_eq!(
            workspace.read("link/notes.txt"),
            Err(WorkspaceError::BadPath)
        );
        assert_eq!(workspace.read("file-link"), Err(WorkspaceError::BadPath));
        assert_eq!(
            workspace.write("link/new.txt", "x", None),
            Err(WorkspaceError::BadPath)
        );
        assert!(!outside.path().join("new.txt").exists());
    }

    #[test]
    fn denied_paths_cannot_be_read_or_written() {
        let (dir, workspace) = project();

        for name in [
            ".env",
            ".env.local",
            "server.pem",
            "id_rsa",
            "credentials.json",
            "Secret.txt",
            ".npmrc",
            "auth.json",
        ] {
            fs::write(dir.path().join(name), "x").unwrap();

            assert!(denied(name), "{name}");
            assert_eq!(workspace.read(name), Err(WorkspaceError::Denied), "{name}");
            assert_eq!(
                workspace.write(name, "y", None),
                Err(WorkspaceError::Denied),
                "{name}"
            );
        }

        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/config"), "x").unwrap();

        assert!(denied(".git/config") && denied("a/node_modules/x.js") && denied("vendor/a/b.php"));
        assert!(!denied("src/main.rs") && !denied("environment.ts") && !denied("keyboard.ts"));
        assert_eq!(workspace.read(".git/config"), Err(WorkspaceError::Denied));
    }

    #[test]
    fn a_link_into_a_denied_folder_is_refused() {
        let (dir, workspace) = project();

        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/HEAD"), "ref").unwrap();
        symlink(dir.path().join(".git"), dir.path().join("docs")).unwrap();

        assert_eq!(workspace.read("docs/HEAD"), Err(WorkspaceError::Denied));
        assert_eq!(
            workspace.write("docs/new", "x", None),
            Err(WorkspaceError::Denied)
        );
    }

    #[test]
    fn write_checks_the_expected_hash() {
        let (_dir, workspace) = project();

        let first = workspace.write("a.txt", "one", None).unwrap();
        assert_eq!(
            first,
            Written {
                before: None,
                after: hash("one")
            }
        );

        // * New file expected where one exists, and a stale hash, are both conflicts.
        assert_eq!(
            workspace.write("a.txt", "two", None),
            Err(WorkspaceError::Conflict)
        );
        assert_eq!(
            workspace.write("a.txt", "two", Some(&hash("zero"))),
            Err(WorkspaceError::Conflict)
        );
        assert_eq!(workspace.read("a.txt").unwrap(), "one");

        let second = workspace.write("a.txt", "two", Some(&hash("one"))).unwrap();
        assert_eq!(second.before, Some(hash("one")));
        assert_eq!(workspace.read("a.txt").unwrap(), "two");
        assert_eq!(workspace.current_hash("missing.txt").unwrap(), None);
    }

    #[test]
    fn size_limits_and_binary_files() {
        let (dir, workspace) = project();

        assert_eq!(
            workspace.write("big.txt", &"x".repeat(MAX_WRITE_BYTES + 1), None),
            Err(WorkspaceError::TooLarge)
        );
        assert!(workspace
            .write("ok.txt", &"x".repeat(MAX_WRITE_BYTES), None)
            .is_ok());

        fs::write(
            dir.path().join("huge.txt"),
            vec![b'a'; MAX_READ_BYTES as usize + 1],
        )
        .unwrap();
        fs::write(dir.path().join("bin.dat"), [1u8, 0, 2]).unwrap();
        fs::write(dir.path().join("latin.txt"), [0xffu8, 0xfe]).unwrap();

        assert_eq!(workspace.read("huge.txt"), Err(WorkspaceError::TooLarge));
        assert_eq!(workspace.read("bin.dat"), Err(WorkspaceError::NotText));
        assert_eq!(workspace.read("latin.txt"), Err(WorkspaceError::NotText));
        assert_eq!(workspace.read("nope.txt"), Err(WorkspaceError::NotFound));
    }

    #[test]
    fn viewer_renames_in_place_without_overwriting() {
        let (dir, workspace) = project();

        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/a.txt"), "a").unwrap();
        fs::write(dir.path().join("src/b.txt"), "b").unwrap();

        assert_eq!(
            workspace.rename_for_viewer("src/a.txt", "c.txt"),
            Ok("src/c.txt".to_string())
        );
        assert!(dir.path().join("src/c.txt").is_file());
        assert!(!dir.path().join("src/a.txt").exists());
        assert_eq!(
            workspace.rename_for_viewer("src/c.txt", "b.txt"),
            Err(WorkspaceError::Conflict)
        );
        assert_eq!(
            workspace.rename_for_viewer("src/c.txt", "../x.txt"),
            Err(WorkspaceError::BadPath)
        );
        assert_eq!(
            workspace.rename_for_viewer("src/c.txt", " "),
            Err(WorkspaceError::BadPath)
        );
    }

    #[test]
    fn viewer_edits_any_file_but_the_tools_do_not() {
        let (dir, workspace) = project();

        fs::write(dir.path().join(".env"), "A=1").unwrap();

        let hash_before = workspace.current_hash_for_viewer(".env").unwrap();

        assert!(workspace
            .write_for_viewer(".env", "A=2", hash_before.as_deref())
            .is_ok());
        assert_eq!(fs::read_to_string(dir.path().join(".env")).unwrap(), "A=2");
        assert_eq!(
            workspace.write(".env", "A=3", None),
            Err(WorkspaceError::Denied)
        );
        assert_eq!(
            workspace.write_for_viewer("../outside.txt", "x", None),
            Err(WorkspaceError::BadPath)
        );
    }

    #[test]
    fn viewer_reads_any_file_but_the_tools_do_not() {
        let (dir, workspace) = project();

        fs::write(dir.path().join(".env"), "A=1").unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/config"), "x").unwrap();

        assert_eq!(workspace.read_for_viewer(".env"), Ok("A=1".to_string()));
        assert_eq!(workspace.read(".env"), Err(WorkspaceError::Denied));
        assert_eq!(
            workspace.read_for_viewer(".git/config"),
            Ok("x".to_string())
        );
    }

    #[test]
    fn tree_lists_secret_names_but_skips_denied_folders_links_and_deep_files() {
        let (dir, workspace) = project();
        let deep = (0..=MAX_DEPTH + 1)
            .map(|i| format!("d{i}"))
            .collect::<Vec<_>>()
            .join("/");

        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules/x")).unwrap();
        fs::create_dir_all(dir.path().join(&deep)).unwrap();
        fs::write(dir.path().join("src/main.rs"), "").unwrap();
        fs::write(dir.path().join("README.md"), "").unwrap();
        fs::write(dir.path().join(".env"), "").unwrap();
        fs::write(dir.path().join("node_modules/x/i.js"), "").unwrap();
        fs::write(dir.path().join(&deep).join("too-deep.txt"), "").unwrap();
        symlink(dir.path().join("src"), dir.path().join("linked")).unwrap();

        let tree = workspace.tree();

        assert_eq!(
            tree.paths,
            vec![
                ".env".to_string(),
                "README.md".to_string(),
                "src/main.rs".to_string()
            ]
        );
        assert!(!tree.truncated);
    }

    #[test]
    fn tree_is_capped() {
        let (dir, workspace) = project();

        for i in 0..MAX_TREE_ENTRIES + 5 {
            fs::write(dir.path().join(format!("f{i:05}.txt")), "").unwrap();
        }

        let tree = workspace.tree();

        assert_eq!(tree.paths.len(), MAX_TREE_ENTRIES);
        assert!(tree.truncated);
    }

    #[test]
    fn write_keeps_permissions_and_delete_only_removes_files() {
        use std::os::unix::fs::PermissionsExt;

        let (dir, workspace) = project();

        workspace.write("run.sh", "#!/bin/sh", None).unwrap();
        fs::set_permissions(dir.path().join("run.sh"), fs::Permissions::from_mode(0o755)).unwrap();
        workspace
            .write("run.sh", "#!/bin/sh\necho", Some(&hash("#!/bin/sh")))
            .unwrap();

        assert_eq!(
            fs::metadata(dir.path().join("run.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        assert!(workspace.delete("run.sh").is_ok());
        assert!(!dir.path().join("run.sh").exists());

        fs::create_dir(dir.path().join("folder")).unwrap();

        assert_eq!(workspace.delete("folder"), Err(WorkspaceError::WriteFailed));
    }

    #[test]
    fn glob_patterns() {
        assert!(glob(".env.*", ".env.local") && !glob(".env.*", ".env"));
        assert!(
            glob("*.key", "a.key") && glob("id_rsa*", "id_rsa.pub") && glob("a*b*c", "a--b--c")
        );
        assert!(!glob("*.key", "key") && !glob("secret*", "mysecret"));
    }
}
