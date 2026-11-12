//! Sandboxed access to one project folder. Port of `LocalWorkspace.php` (path guards, tree, read, write with hash check).
//!
//! The caller names files by relative path only. Every path is cleaned, checked against the deny list and resolved to a real path that must stay inside the root (links cannot escape; for a new file its parent folder is checked).
//! Errors carry fixed messages and never a path of this machine.

use crate::permission::{Guarded, PathPolicy, Sandbox, Unguarded};
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

const MAX_SEGMENT_BYTES: usize = 255;

/// Folder names (any level) nobody may read or write: repo internals and dependencies.
const DENIED_DIRECTORIES: [&str; 4] = [".git", "storage", "vendor", "node_modules"];

/// Never listed in the tree (VS Code's default `files.exclude`).
const HIDDEN_FROM_TREE: [&str; 6] = [".git", ".svn", ".hg", "CVS", ".DS_Store", "Thumbs.db"];

/// Shell-style patterns (`*` only) matched against the lower-cased file name: secrets, keys and macOS's `.DS_Store`.
const DENIED_NAMES: [&str; 19] = [
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
    ".ds_store",
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
            Self::UnknownRoot => "workspace.unknown_root",
            Self::BadPath => "workspace.bad_path",
            Self::Denied => "workspace.denied",
            Self::NotFound => "workspace.not_found",
            Self::NotText => "workspace.not_text",
            Self::TooLarge => "workspace.too_large",
            Self::Conflict => "workspace.conflict",
            Self::WriteFailed => "workspace.write_failed",
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
        || path.chars().any(is_invisible_format)
        || drive
    {
        return None;
    }

    let segments: Vec<&str> = path.split('/').collect();

    if segments
        .iter()
        .any(|s| matches!(*s, "" | "." | "..") || !portable_segment(s))
    {
        return None;
    }

    Some(segments.join("/"))
}

/// Unicode format characters (zero-width, bidi overrides, BOM, soft hyphen) that make a name look like another one.
fn is_invisible_format(character: char) -> bool {
    matches!(
        character,
        '\u{00AD}'
            | '\u{061C}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{206F}'
            | '\u{FEFF}'
    )
}

/// One path segment that is safe on every platform: short, no Windows stream (`:`), no trailing dot/space, no device name.
fn portable_segment(segment: &str) -> bool {
    if segment.len() > MAX_SEGMENT_BYTES
        || segment.contains(':')
        || segment.ends_with('.')
        || segment.ends_with(' ')
    {
        return false;
    }

    let stem = segment.split('.').next().unwrap_or("").to_ascii_lowercase();
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix)
            .is_some_and(|rest| matches!(rest.as_bytes(), [b'1'..=b'9']))
    };

    !(matches!(stem.as_str(), "con" | "prn" | "aux" | "nul") || numbered("com") || numbered("lpt"))
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
    sandbox: Sandbox,
}

impl Workspace {
    /// Opens a project folder; the root is stored as its real path.
    pub fn open(path: &Path) -> Result<Self> {
        Sandbox::open(path)
            .map(|sandbox| Self { sandbox })
            .ok_or(WorkspaceError::UnknownRoot)
    }

    pub fn root(&self) -> &Path {
        self.sandbox.root()
    }

    /// A session that reaches files under `policy` (Proxy over the file system).
    pub fn access<'a>(&'a self, policy: &'a dyn PathPolicy) -> Access<'a> {
        Access {
            workspace: self,
            policy,
        }
    }

    /// What lies directly in the project root, for the tree's first paint: files as `name`, folders as `name/`. Folders are read when the person opens them (`list_directory`), so a huge project costs nothing up front.
    pub fn tree(&self) -> Tree {
        let (paths, truncated) = self.list_in(self.root(), "");

        Tree { paths, truncated }
    }

    /// What lies directly in one folder: files as `dir/name`, sub-folders as `dir/name/`. Links are skipped; secret files are listed by name only. `.git` and OS junk are hidden; `node_modules` can be listed (never read).
    pub fn list_directory(&self, path: &str) -> Result<Tree> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;
        let full =
            fs::canonicalize(self.root().join(&relative)).map_err(|_| WorkspaceError::NotFound)?;

        if !full.is_dir() {
            return Err(WorkspaceError::NotFound);
        }

        if !self.sandbox.contains(&full) {
            return Err(WorkspaceError::BadPath);
        }

        let (paths, truncated) = self.list_in(&full, &relative);

        Ok(Tree { paths, truncated })
    }

    fn list_in(&self, dir: &Path, prefix: &str) -> (Vec<String>, bool) {
        let Ok(entries) = fs::read_dir(dir) else {
            return (Vec::new(), false);
        };
        let mut paths: Vec<String> = entries
            .flatten()
            .filter_map(|entry| {
                let kind = entry.file_type().ok()?;
                let name = entry.file_name().to_string_lossy().into_owned();

                if HIDDEN_FROM_TREE.contains(&name.as_str()) {
                    return None;
                }

                let relative = if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix}/{name}")
                };

                if kind.is_dir() {
                    Some(format!("{relative}/"))
                } else if kind.is_file() {
                    Some(relative)
                } else {
                    None
                }
            })
            .collect();
        let truncated = paths.len() > MAX_TREE_ENTRIES;

        paths.sort();
        paths.truncate(MAX_TREE_ENTRIES);

        (paths, truncated)
    }

    /// Text of a file for the viewer only: like `read`, but secret files (`.env`, keys) can be opened to look at; folders such as `.git` stay closed. The AI's tools keep using `read`.
    pub fn read_for_viewer(&self, path: &str) -> Result<String> {
        self.access(&Unguarded).read(path)
    }

    /// Text of one allowed file. Refuses denied names, links leaving the root, binary data and files over the size limit.
    pub fn read(&self, path: &str) -> Result<String> {
        self.access(&Guarded).read(path)
    }

    /// Raw bytes of one allowed file for the viewer (a picture or a PDF). Same guards as `read`, with the larger media limit.
    pub fn read_bytes(&self, path: &str) -> Result<Vec<u8>> {
        self.access(&Guarded).read_bytes(path)
    }

    /// Hash of the file's current content, or None when it does not exist (a new file).
    pub fn current_hash(&self, path: &str) -> Result<Option<String>> {
        self.access(&Guarded).current_hash(path)
    }

    /// Atomic write: temp file in the same folder, then rename, keeping the file's permissions.
    /// `expected` is the hash seen when the edit was proposed (None = the file did not exist); any other current state is a conflict.
    pub fn write(&self, path: &str, content: &str, expected: Option<&str>) -> Result<Written> {
        self.access(&Guarded).write(path, content, expected)
    }

    /// Save made by the person in the viewer: like `write`, but secret files (`.env`, keys) can be edited; folders such as `.git` stay closed. The AI's tools keep using `write`.
    pub fn write_for_viewer(
        &self,
        path: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Result<Written> {
        self.access(&Unguarded).write(path, content, expected)
    }

    /// Hash of the file's current content for the viewer's save (secret files included), or None when it does not exist.
    pub fn current_hash_for_viewer(&self, path: &str) -> Result<Option<String>> {
        self.access(&Unguarded).current_hash(path)
    }

    /// Renames a file or folder in place (same folder, new name) and returns its new relative path. The person's action from the viewer: nothing is refused but leaving the project, the name must be a single plain name, and an existing file is never overwritten.
    pub fn rename_for_viewer(&self, path: &str, new_name: &str) -> Result<String> {
        self.access(&Unguarded).rename(path, new_name)
    }

    /// Creates an empty file or folder inside `folder` (empty: the project root): the person's action in the file tree.
    pub fn create_for_viewer(&self, folder: &str, name: &str, is_folder: bool) -> Result<String> {
        self.access(&Unguarded).create(folder, name, is_folder)
    }

    /// Copies a file or folder into `folder` under a free name: the person's action in the file tree.
    pub fn copy_for_viewer(&self, path: &str, folder: &str) -> Result<String> {
        self.access(&Unguarded).copy(path, folder)
    }

    /// Copies a file or folder from outside the project into `folder`: the person's drop on the file tree.
    pub fn import_for_viewer(&self, source: &Path, folder: &str) -> Result<String> {
        self.access(&Unguarded).import(source, folder)
    }

    /// Moves a file or folder into `folder`: the person's drag and drop in the file tree.
    pub fn move_for_viewer(&self, path: &str, folder: &str) -> Result<String> {
        self.access(&Unguarded).move_into(path, folder)
    }

    /// Removes a file, a folder with everything in it, or a link (only the link itself): the person's action in the file tree.
    pub fn delete_for_viewer(&self, path: &str) -> Result<()> {
        self.access(&Unguarded).delete_entry(path)
    }

    /// Removes a regular file (a new file being discarded); never a link, never a folder.
    pub fn delete(&self, path: &str) -> Result<()> {
        self.access(&Guarded).delete(path)
    }

    /// Real path of an existing allowed file, for handing to another program (the editor) that opens it itself.
    pub fn existing_path(&self, path: &str) -> Result<PathBuf> {
        self.access(&Guarded).existing_file(path)
    }

    pub fn allowed_relative(&self, path: &str) -> Result<String> {
        self.access(&Guarded).allowed_relative(path)
    }
}

/// One session of reaching files in a workspace under a path policy: the policy decides which names are refused, the sandbox keeps every real path inside the root.
pub struct Access<'a> {
    workspace: &'a Workspace,
    policy: &'a dyn PathPolicy,
}

impl Access<'_> {
    fn sandbox(&self) -> &Sandbox {
        &self.workspace.sandbox
    }

    pub fn read(&self, path: &str) -> Result<String> {
        let full = self.existing_file(path)?;
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

    pub fn current_hash(&self, path: &str) -> Result<Option<String>> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if self.policy.refuses(&relative) {
            return Err(WorkspaceError::Denied);
        }

        // * The parent folder is always checked with `Guarded`, whatever the policy: the viewer can read but never save into `.git/`, `node_modules/`...
        let parent = self.parent_directory_with(&relative, &Guarded)?;
        let full = parent.join(file_name(&relative));

        if fs::symlink_metadata(&full).is_err() {
            return Ok(None);
        }

        self.read(path).map(|content| Some(hash(&content)))
    }

    pub fn write(&self, path: &str, content: &str, expected: Option<&str>) -> Result<Written> {
        if content.len() > MAX_WRITE_BYTES {
            return Err(WorkspaceError::TooLarge);
        }

        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if self.policy.refuses(&relative) {
            return Err(WorkspaceError::Denied);
        }

        let parent = self.parent_directory(&relative)?;
        let full = parent.join(file_name(&relative));

        // * A link as the target could point anywhere, even when its folder is inside the root.
        if fs::symlink_metadata(&full).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(WorkspaceError::BadPath);
        }

        let current = self.current_hash(path)?;

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

    pub fn rename(&self, path: &str, new_name: &str) -> Result<String> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;
        let name = new_name.trim();

        if !plain_name(name) {
            return Err(WorkspaceError::BadPath);
        }

        // * Same policy as write: nothing moves into, out of, or onto a closed folder.
        let target = match relative.rsplit_once('/') {
            Some((folder, _)) => format!("{folder}/{name}"),
            None => name.to_string(),
        };

        if in_denied_directory(&relative) || in_denied_directory(&target) {
            return Err(WorkspaceError::Denied);
        }

        // * The parent folder is checked with `Unguarded`: only leaving the project is refused.
        let parent = self.parent_directory_with(&relative, &Unguarded)?;
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

    /// The real folder behind a folder path from the viewer (empty: the project root) and its normalised relative path ("" for the root). Only leaving the project and the closed folders are refused.
    fn folder_for_entries(&self, folder: &str) -> Result<(PathBuf, String)> {
        if folder.is_empty() {
            let root = self.parent_directory_with("x", &Unguarded)?;

            return Ok((root, String::new()));
        }

        let relative = normalise(folder).ok_or(WorkspaceError::BadPath)?;

        if in_denied_directory(&relative) {
            return Err(WorkspaceError::Denied);
        }

        let real = self.parent_directory_with(&format!("{relative}/x"), &Unguarded)?;

        Ok((real, relative))
    }

    /// Creates an empty file or folder named `name` inside `folder` and returns its relative path. An existing entry is never touched.
    pub fn create(&self, folder: &str, name: &str, is_folder: bool) -> Result<String> {
        let name = name.trim();

        if !plain_name(name) {
            return Err(WorkspaceError::BadPath);
        }

        let (directory, relative_folder) = self.folder_for_entries(folder)?;
        let target = directory.join(name);

        if fs::symlink_metadata(&target).is_ok() {
            return Err(WorkspaceError::Conflict);
        }

        let made = if is_folder {
            fs::create_dir(&target)
        } else {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map(|_| ())
        };

        made.map_err(|_| WorkspaceError::WriteFailed)?;

        Ok(join_relative(&relative_folder, name))
    }

    /// Copies a file or folder into `folder` (empty: the project root) under a free name (`a copy.txt`, `a copy 2.txt`) and returns the new relative path. Links inside a copied folder are left out.
    pub fn copy(&self, path: &str, folder: &str) -> Result<String> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;
        let source = self.entry_for_change(&relative)?;
        let (directory, relative_folder) = self.folder_for_entries(folder)?;

        if in_denied_directory(&relative) {
            return Err(WorkspaceError::Denied);
        }

        // * A folder copied into itself would never end.
        if source.is_dir() && directory.starts_with(&source) {
            return Err(WorkspaceError::BadPath);
        }

        let name = free_name(&directory, file_name(&relative));
        let target = directory.join(&name);
        let mut budget = MAX_COPY_ENTRIES;

        copy_entry(&source, &target, &mut budget).inspect_err(|_| {
            // * A half-made copy is removed again.
            let _ = if target.is_dir() {
                fs::remove_dir_all(&target)
            } else {
                fs::remove_file(&target)
            };
        })?;

        Ok(join_relative(&relative_folder, &name))
    }

    /// Copies a file or folder from outside the project (dropped on the file tree) into `folder` (empty: the project root) under a free name and returns the new relative path. Links are refused, and a folder holding the project is too big a source to take.
    pub fn import(&self, source: &Path, folder: &str) -> Result<String> {
        if !source.is_absolute() {
            return Err(WorkspaceError::BadPath);
        }

        let meta = fs::symlink_metadata(source).map_err(|_| WorkspaceError::NotFound)?;

        if meta.file_type().is_symlink() {
            return Err(WorkspaceError::BadPath);
        }

        let source_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(WorkspaceError::BadPath)?;
        let (directory, relative_folder) = self.folder_for_entries(folder)?;

        if in_denied_directory(&join_relative(&relative_folder, source_name)) {
            return Err(WorkspaceError::Denied);
        }

        // * A folder dropped onto itself or onto what it holds would never end.
        // * Compared by real path: the folders are canonical, a path the person dropped may not be.
        if meta.is_dir() {
            let real = fs::canonicalize(source).map_err(|_| WorkspaceError::NotFound)?;

            if directory.starts_with(&real) {
                return Err(WorkspaceError::BadPath);
            }
        }

        let name = free_name(&directory, source_name);
        let target = directory.join(&name);
        let mut budget = MAX_COPY_ENTRIES;

        copy_entry(source, &target, &mut budget).inspect_err(|_| {
            // * A half-made copy is removed again.
            let _ = if target.is_dir() {
                fs::remove_dir_all(&target)
            } else {
                fs::remove_file(&target)
            };
        })?;

        Ok(join_relative(&relative_folder, &name))
    }

    /// Moves a file or folder into `folder` (empty: the project root) and returns the new relative path. Nothing is overwritten, a folder never goes into itself.
    pub fn move_into(&self, path: &str, folder: &str) -> Result<String> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;
        let source = self.entry_for_change(&relative)?;
        let (directory, relative_folder) = self.folder_for_entries(folder)?;
        let name = file_name(&relative);
        let target_relative = join_relative(&relative_folder, name);

        if in_denied_directory(&relative) || in_denied_directory(&target_relative) {
            return Err(WorkspaceError::Denied);
        }

        if source.is_dir() && directory.starts_with(&source) {
            return Err(WorkspaceError::BadPath);
        }

        let target = directory.join(name);

        if target == source {
            return Ok(relative);
        }

        if fs::symlink_metadata(&target).is_ok() {
            return Err(WorkspaceError::Conflict);
        }

        fs::rename(&source, &target).map_err(|_| WorkspaceError::WriteFailed)?;

        Ok(target_relative)
    }

    /// The real path of an existing file or folder that is about to be copied or moved; never a link.
    fn entry_for_change(&self, relative: &str) -> Result<PathBuf> {
        let parent = self.parent_directory_with(relative, &Unguarded)?;
        let full = parent.join(file_name(relative));
        let meta = fs::symlink_metadata(&full).map_err(|_| WorkspaceError::NotFound)?;

        if meta.file_type().is_symlink() {
            return Err(WorkspaceError::BadPath);
        }

        Ok(full)
    }

    /// Removes an existing file or folder (with all it holds) for good. A link is unlinked and its target is left alone; nothing in a denied folder (`.git`, `node_modules`...) and never the project root.
    pub fn delete_entry(&self, path: &str) -> Result<()> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if in_denied_directory(&relative) {
            return Err(WorkspaceError::Denied);
        }

        let parent = self.parent_directory_with(&relative, &Unguarded)?;

        // * A folder reached through a link may resolve into a denied one (e.g. `docs` -> `.git`).
        if in_denied_directory(&self.sandbox().relative(&parent)) {
            return Err(WorkspaceError::Denied);
        }

        let full = parent.join(file_name(&relative));
        let meta = fs::symlink_metadata(&full).map_err(|_| WorkspaceError::NotFound)?;
        // * `symlink_metadata` does not follow: a link is neither a folder nor a file here, so only the link goes.
        let removed = if meta.file_type().is_dir() {
            fs::remove_dir_all(&full)
        } else {
            fs::remove_file(&full)
        };

        removed.map_err(|_| WorkspaceError::WriteFailed)
    }

    pub fn delete(&self, path: &str) -> Result<()> {
        let relative = self.allowed_relative(path)?;
        let full = self.parent_directory(&relative)?.join(file_name(&relative));
        let meta = fs::symlink_metadata(&full).map_err(|_| WorkspaceError::WriteFailed)?;

        if meta.file_type().is_symlink() || !meta.is_file() || fs::remove_file(&full).is_err() {
            return Err(WorkspaceError::WriteFailed);
        }

        Ok(())
    }

    pub fn allowed_relative(&self, path: &str) -> Result<String> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if self.policy.refuses(&relative) {
            return Err(WorkspaceError::Denied);
        }

        Ok(relative)
    }

    /// Real path of an existing regular file inside the root (re-checked against the policy after links are resolved).
    fn existing_file(&self, path: &str) -> Result<PathBuf> {
        let relative = normalise(path).ok_or(WorkspaceError::BadPath)?;

        if self.policy.refuses(&relative) {
            return Err(WorkspaceError::Denied);
        }

        let full = fs::canonicalize(self.sandbox().root().join(&relative))
            .map_err(|_| WorkspaceError::NotFound)?;

        if !full.is_file() {
            return Err(WorkspaceError::NotFound);
        }

        if !self.sandbox().contains(&full) {
            return Err(WorkspaceError::BadPath);
        }

        if self.policy.refuses(&self.sandbox().relative(&full)) {
            return Err(WorkspaceError::Denied);
        }

        Ok(full)
    }

    /// Real path of the folder that holds (or will hold) the file; it must exist and sit inside the root.
    fn parent_directory(&self, relative: &str) -> Result<PathBuf> {
        self.parent_directory_with(relative, self.policy)
    }

    fn parent_directory_with(&self, relative: &str, policy: &dyn PathPolicy) -> Result<PathBuf> {
        let dir = Path::new(relative)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        let parent = fs::canonicalize(self.sandbox().root().join(dir))
            .map_err(|_| WorkspaceError::NotFound)?;

        if !parent.is_dir() {
            return Err(WorkspaceError::NotFound);
        }

        if !self.sandbox().contains(&parent) {
            return Err(WorkspaceError::BadPath);
        }

        // * A folder reached through a link may resolve into a denied one (e.g. `docs` -> `.git`).
        if policy.refuses(&format!("{}/x", self.sandbox().relative(&parent))) {
            return Err(WorkspaceError::Denied);
        }

        Ok(parent)
    }
}

/// A single plain name for an entry: no separator or control character, not `.` / `..`, portable on every platform.
fn plain_name(name: &str) -> bool {
    !(name.is_empty()
        || name.len() > MAX_PATH_BYTES
        || matches!(name, "." | "..")
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
        || !portable_segment(name)
        || name.chars().any(is_invisible_format))
}

fn join_relative(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    }
}

/// Most entries one copy may make: a folder with node_modules-sized content is not copied by accident.
const MAX_COPY_ENTRIES: usize = 5000;

/// `name` when free in `directory`, else `stem copy.ext`, `stem copy 2.ext`...
fn free_name(directory: &Path, name: &str) -> String {
    if fs::symlink_metadata(directory.join(name)).is_err() {
        return name.to_string();
    }

    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };

    (1..)
        .map(|number| {
            if number == 1 {
                format!("{stem} copy{extension}")
            } else {
                format!("{stem} copy {number}{extension}")
            }
        })
        .find(|candidate| fs::symlink_metadata(directory.join(candidate)).is_err())
        .unwrap_or_else(|| name.to_string())
}

/// Copies a file, or a folder with what is inside it (links are skipped), counting every entry against `budget`.
fn copy_entry(source: &Path, target: &Path, budget: &mut usize) -> Result<()> {
    *budget = budget.checked_sub(1).ok_or(WorkspaceError::TooLarge)?;

    let meta = fs::symlink_metadata(source).map_err(|_| WorkspaceError::NotFound)?;

    if meta.file_type().is_symlink() {
        return Ok(());
    }

    if meta.is_dir() {
        fs::create_dir(target).map_err(|_| WorkspaceError::WriteFailed)?;

        for entry in fs::read_dir(source).map_err(|_| WorkspaceError::NotFound)? {
            let entry = entry.map_err(|_| WorkspaceError::NotFound)?;

            // * Closed folders (repo internals, dependencies) inside a copied folder stay behind.
            if DENIED_DIRECTORIES
                .contains(&entry.file_name().to_string_lossy().to_lowercase().as_str())
            {
                continue;
            }

            copy_entry(&entry.path(), &target.join(entry.file_name()), budget)?;
        }

        return Ok(());
    }

    fs::copy(source, target)
        .map(|_| ())
        .map_err(|_| WorkspaceError::WriteFailed)
}

fn file_name(relative: &str) -> &str {
    relative.rsplit('/').next().unwrap_or(relative)
}

#[cfg(test)]
#[path = "../tests/unit/workspace.rs"]
mod tests;
