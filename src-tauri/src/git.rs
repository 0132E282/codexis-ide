//! Git of the open project through the `git` command (same behaviour as `LocalWorkspace.php`): changed files, `HEAD` text, discard, commit, branches.
//! Submodules are opened one level deep. Files the deny list hides never show up and are never committed. Nothing is pushed.

use crate::workspace::{self, Workspace, WorkspaceError};
use serde::Serialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const MAX_CHANGES: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Change {
    pub path: String,
    pub status: ChangeStatus,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    /// Submodule the file lives in (its own repo); absent for the main repo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// Serialized as the single letters the front end expects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ChangeStatus {
    #[serde(rename = "A")]
    Added,
    #[serde(rename = "D")]
    Deleted,
    #[serde(rename = "M")]
    Modified,
}

#[derive(Debug, Serialize)]
pub struct Worktree {
    pub name: String,
    pub branch: Option<String>,
    pub current: bool,
}

#[derive(Debug, Serialize)]
pub struct Branches {
    pub git: bool,
    pub current: Option<String>,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
}

#[derive(Debug, Serialize)]
pub struct Committed {
    pub hash: String,
    pub files: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitError {
    Workspace(WorkspaceError),
    NothingToCommit,
    CommitFailed,
    WorktreeFailed,
    PullFailed,
}

impl GitError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Workspace(error) => error.message(),
            Self::NothingToCommit => "git.nothing_to_commit",
            Self::CommitFailed => "git.commit_failed",
            Self::WorktreeFailed => "git.worktree_failed",
            Self::PullFailed => "git.pull_failed",
        }
    }
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for GitError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Workspace(error) => Some(error),
            Self::NothingToCommit
            | Self::CommitFailed
            | Self::WorktreeFailed
            | Self::PullFailed => None,
        }
    }
}

impl From<WorkspaceError> for GitError {
    fn from(error: WorkspaceError) -> Self {
        Self::Workspace(error)
    }
}

/// The arguments of the Pull button, also what the preview shows.
const PULL_ARGS: [&str; 2] = ["pull", "--ff-only"];

/// Which tab of the Commit / Pull request popup a command preview is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlannedMode {
    Commit,
    PullRequest,
}

/// The title as a double-quoted shell word on one line: only its first line is shown, `"` `\\` `$` and backticks escaped.
fn quoted_title(title: &str) -> String {
    let first = title.lines().next().unwrap_or("").trim();
    let mut quoted = String::from("\"");

    for character in first.chars() {
        if matches!(character, '"' | '\\' | '$' | '`') {
            quoted.push('\\');
        }

        quoted.push(character);
    }

    quoted.push('"');

    quoted
}

/// Stdout of `git <args>` in `dir`; None when git is missing or the command fails.
fn run(dir: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new("git")
        .arg("--no-optional-locks")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        // * File names are data: `*`, `[a]` or `:(top)x` must never act as pathspec magic.
        .env("GIT_LITERAL_PATHSPECS", "1")
        .output()
        .ok()?;

    output.status.success().then_some(output.stdout)
}

fn text(bytes: &[u8]) -> Cow<'_, str> {
    String::from_utf8_lossy(bytes)
}

/// Paths of the submodules the root declares in `.gitmodules`.
fn submodules(root: &Path) -> Vec<String> {
    if !root.join(".gitmodules").is_file() {
        return Vec::new();
    }

    let Some(out) = run(
        root,
        &[
            "config",
            "--file",
            ".gitmodules",
            "--get-regexp",
            r"^submodule\..*\.path$",
        ],
    ) else {
        return Vec::new();
    };

    text(&out)
        .lines()
        .filter_map(|row| row.split_once(char::is_whitespace))
        .filter_map(|(_, path)| workspace::normalise(path.trim()))
        .filter(|path| root.join(path).is_dir())
        .collect()
}

/// The git folder a file belongs to (its submodule, else the root) and its path in there.
fn repo_of(root: &Path, relative: &str) -> (PathBuf, String) {
    for module in submodules(root) {
        if let Some(inner) = relative
            .strip_prefix(module.as_str())
            .and_then(|rest| rest.strip_prefix('/'))
        {
            return (root.join(&module), inner.to_string());
        }
    }

    (root.to_path_buf(), relative.to_string())
}

/// Lines of a small new text file; None when it is large, binary or unreadable.
fn line_count(full: &Path) -> Option<u32> {
    let meta = fs::symlink_metadata(full).ok()?;

    if !meta.is_file() || meta.len() > workspace::MAX_READ_BYTES {
        return None;
    }

    let bytes = fs::read(full).ok()?;

    if bytes.contains(&0) {
        return None;
    }

    // * The file is at most MAX_READ_BYTES, so the count always fits.
    let newlines = u32::try_from(bytes.iter().filter(|&&byte| byte == b'\n').count()).ok()?;

    Some(match bytes.last() {
        None => 0,
        Some(b'\n') => newlines,
        Some(_) => newlines + 1,
    })
}

/// Changed files of one git folder (`prefix` is its path under the root, "" for the root); None when it is not a git folder.
fn git_changes(dir: &Path, prefix: &str, submodules: &[String]) -> Option<Vec<Change>> {
    // * `status` names files from the top of the repository, so a folder inside a larger repository (this one's `src-tauri`) gets only its own files, with this prefix cut off.
    let inside = run(dir, &["rev-parse", "--show-prefix"])
        .map(|out| text(&out).trim().to_string())
        .unwrap_or_default();
    let status = run(
        dir,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ],
    )?;
    let mut counts = HashMap::new();

    if let Some(numstat) = run(dir, &["diff", "HEAD", "--numstat", "-z", "--relative"]) {
        for row in text(&numstat).split('\0') {
            let mut parts = row.splitn(3, '\t');

            if let (Some(added), Some(removed), Some(path)) =
                (parts.next(), parts.next(), parts.next())
            {
                counts.insert(
                    path.to_string(),
                    (added.parse::<u32>().ok(), removed.parse::<u32>().ok()),
                );
            }
        }
    }

    let status = text(&status);
    let entries: Vec<&str> = status.split('\0').collect();
    let mut files = Vec::new();
    let mut index = 0;

    while index < entries.len() && files.len() < MAX_CHANGES {
        let entry = entries[index];

        index += 1;

        if entry.len() < 4 || !entry.is_char_boundary(3) {
            continue;
        }

        let (code, listed) = (&entry[..2], &entry[3..]);
        let Some(path) = listed.strip_prefix(inside.as_str()) else {
            continue;
        };

        // * A rename or copy is followed by the old path.
        if code.contains('R') || code.contains('C') {
            index += 1;
        }

        let Some(relative) = workspace::normalise(&format!("{prefix}{path}")) else {
            continue;
        };

        if workspace::denied(&relative) {
            continue;
        }

        if prefix.is_empty() && submodules.contains(&relative) {
            for file in
                git_changes(&dir.join(&relative), &format!("{relative}/"), &[]).unwrap_or_default()
            {
                files.push(Change {
                    repo: Some(relative.clone()),
                    ..file
                });
            }

            continue;
        }

        let status = if code == "??" || code.contains('A') {
            ChangeStatus::Added
        } else if code.contains('D') {
            ChangeStatus::Deleted
        } else {
            ChangeStatus::Modified
        };
        let (mut added, mut removed) = counts.get(path).copied().unwrap_or((None, None));

        if code == "??" {
            added = line_count(&dir.join(path));
            removed = Some(0);
        }

        files.push(Change {
            path: relative,
            status,
            added,
            removed,
            repo: None,
        });
    }

    Some(files)
}

/// Facade over the `git` command for one workspace.
pub struct GitRepo<'a> {
    workspace: &'a Workspace,
}

impl<'a> GitRepo<'a> {
    pub fn new(workspace: &'a Workspace) -> Self {
        Self { workspace }
    }

    /// Files that differ from `HEAD`, sorted by path; None when the project is not a git folder.
    pub fn changes(&self) -> Option<Vec<Change>> {
        let root = self.workspace.root();
        let mut files = git_changes(root, "", &submodules(root))?;

        files.sort_by(|a, b| a.path.cmp(&b.path));

        Some(files)
    }

    /// The file as `HEAD` has it; None for a file that is not in it. Same guards as reading the file.
    pub fn head_content(&self, path: &str) -> Result<Option<String>, WorkspaceError> {
        let relative = self.workspace.allowed_relative(path)?;
        let (dir, inner) = repo_of(self.workspace.root(), &relative);

        let object = format!("HEAD:./{inner}");

        // * Ask for the blob size first so a huge file is never loaded into memory.
        let Some(size) = run(&dir, &["cat-file", "-s", &object]) else {
            return Ok(None);
        };

        if text(&size)
            .trim()
            .parse::<u64>()
            .map_or(true, |size| size > workspace::MAX_READ_BYTES)
        {
            return Err(WorkspaceError::TooLarge);
        }

        let Some(bytes) = run(&dir, &["show", &object]) else {
            return Ok(None);
        };

        if u64::try_from(bytes.len()).map_or(true, |size| size > workspace::MAX_READ_BYTES) {
            return Err(WorkspaceError::TooLarge);
        }

        if bytes.contains(&0) {
            return Err(WorkspaceError::NotText);
        }

        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| WorkspaceError::NotText)
    }

    /// Puts a file back as `HEAD` has it; a new file (not in `HEAD`) is removed.
    pub fn discard(&self, path: &str) -> Result<(), WorkspaceError> {
        match self.head_content(path)? {
            Some(head) => {
                let current = self.workspace.current_hash(path)?;

                self.workspace
                    .write(path, &head, current.as_deref())
                    .map(|_| ())
            }
            None => self.workspace.delete(path),
        }
    }

    /// Paths of the main repo's changed files (a submodule's files are shown but committed with its own repo).
    fn own_paths(&self) -> Result<Vec<String>, GitError> {
        let paths: Vec<String> = self
            .changes()
            .unwrap_or_default()
            .into_iter()
            .filter(|file| file.repo.is_none())
            .map(|file| file.path)
            .collect();

        if paths.is_empty() {
            Err(GitError::NothingToCommit)
        } else {
            Ok(paths)
        }
    }

    /// Longest diff handed to the AI for a commit message, in characters.
    const DIFF_LIMIT: usize = 12_000;

    /// The diff of the files the change list shows (cut at `DIFF_LIMIT`), with their names first so new files count too.
    pub fn diff_text(&self) -> Result<String, GitError> {
        let paths = self.own_paths()?;
        let mut args = vec!["diff", "HEAD", "--"];

        args.extend(paths.iter().map(String::as_str));

        let diff = run(self.workspace.root(), &args)
            .map(|out| text(&out).into_owned())
            .unwrap_or_default();
        let mut out = format!("Changed files:\n{}\n\n{diff}", paths.join("\n"));

        if let Some((index, _)) = out.char_indices().nth(Self::DIFF_LIMIT) {
            out.truncate(index);
        }

        Ok(out)
    }

    /// Commits what the change list shows, never other staged files; nothing is pushed.
    pub fn commit(&self, message: &str) -> Result<Committed, GitError> {
        let paths = self.own_paths()?;
        let root = self.workspace.root();
        let mut add = vec!["add", "--"];
        let mut commit = vec!["commit", "-m", message, "--"];

        // * `add` fails on a deleted path (literal pathspec), `commit --` still records it.
        add.extend(
            paths
                .iter()
                .filter(|path| root.join(path).symlink_metadata().is_ok())
                .map(String::as_str),
        );
        commit.extend(paths.iter().map(String::as_str));

        if add.len() > 2 {
            run(root, &add).ok_or(GitError::CommitFailed)?;
        }

        run(root, &commit).ok_or(GitError::CommitFailed)?;

        let hash = run(root, &["rev-parse", "--short", "HEAD"])
            .map(|out| text(&out).trim().to_string())
            .unwrap_or_default();

        Ok(Committed {
            hash,
            files: paths.len(),
        })
    }

    /// Fast-forwards the current branch from its upstream (`git pull --ff-only`): never merges or commits.
    /// On failure the error is what git printed on stderr, so the user sees the real reason.
    pub fn pull(&self) -> Result<String, String> {
        let output = Command::new("git")
            .args(PULL_ARGS)
            .current_dir(self.workspace.root())
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .output()
            .map_err(|_| "git.not_installed".to_string())?;

        if output.status.success() {
            return Ok(text(&output.stdout).trim().to_string());
        }

        let reason = text(&output.stderr).trim().to_string();

        Err(if reason.is_empty() {
            GitError::PullFailed.message().to_string()
        } else {
            reason
        })
    }

    /// The git commands the Commit or Pull request tab will run, one per line, in the order they run.
    pub fn planned_commands(
        &self,
        mode: PlannedMode,
        title: &str,
        base: &str,
    ) -> Result<Vec<String>, GitError> {
        let title = quoted_title(title);
        let root = self.workspace.root();

        match mode {
            PlannedMode::Commit => {
                let files = self
                    .own_paths()?
                    .iter()
                    .filter(|path| root.join(path).symlink_metadata().is_ok())
                    .count();

                Ok(vec![
                    format!("git add -- {files} files"),
                    format!("git commit -m {title}"),
                ])
            }
            PlannedMode::PullRequest => {
                let branch = run(root, &["rev-parse", "--abbrev-ref", "HEAD"])
                    .map(|out| text(&out).trim().to_string())
                    .unwrap_or_default();
                let has_upstream = run(
                    root,
                    &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
                )
                .is_some();
                let push = if has_upstream {
                    "git push".to_string()
                } else {
                    format!("git push --set-upstream origin {branch}")
                };
                let base = base.trim();
                let base = if base.is_empty() {
                    String::new()
                } else {
                    format!(" --base {base}")
                };

                Ok(vec![push, format!("gh pr create{base} --title {title}")])
            }
        }
    }

    /// The URL of the `origin` remote; None when there is none.
    pub fn origin_url(&self) -> Option<String> {
        let output = run(self.workspace.root(), &["remote", "get-url", "origin"])?;

        Some(text(&output).trim().to_string()).filter(|url| !url.is_empty())
    }

    /// Local branches and worktrees (a worktree shows its folder name, never its full path).
    pub fn branches(&self) -> Branches {
        let root = self.workspace.root();
        let Some(list) = run(root, &["branch", "--format=%(HEAD)|%(refname:short)"]) else {
            return Branches {
                git: false,
                current: None,
                branches: Vec::new(),
                worktrees: Vec::new(),
            };
        };

        let mut current = None;
        let mut names = Vec::new();

        for line in text(&list).lines() {
            let (head, name) = line.split_once('|').unwrap_or(("", ""));

            if name.is_empty() || name.starts_with('(') {
                continue;
            }

            names.push(name.to_string());

            if head == "*" {
                current = Some(name.to_string());
            }
        }

        let mut worktrees = Vec::new();

        if let Some(out) = run(root, &["worktree", "list", "--porcelain"]) {
            for block in text(&out).split("\n\n") {
                let path = block.lines().find_map(|l| l.strip_prefix("worktree "));
                let branch = block
                    .lines()
                    .find_map(|l| l.strip_prefix("branch refs/heads/"))
                    .map(str::to_string);

                if let Some(path) = path {
                    let path = Path::new(path);

                    worktrees.push(Worktree {
                        name: path
                            .file_name()
                            .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
                        branch,
                        current: fs::canonicalize(path).is_ok_and(|real| real == root),
                    });
                }
            }
        }

        Branches {
            git: true,
            current,
            branches: names,
            worktrees,
        }
    }
}

/// Worktree names are 1–64 letters, digits or dashes, so a name never leaves `base`.
fn valid_worktree_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// Folder to run an AI turn in on its own branch: a git worktree `name` under `base` (made on the first call, reused after), on branch `codexis/<name>`.
/// `root` may be a folder inside the repository: the same folder inside the worktree is returned.
pub fn ensure_worktree(root: &Path, base: &Path, name: &str) -> Result<PathBuf, GitError> {
    if !valid_worktree_name(name) {
        return Err(GitError::WorktreeFailed);
    }

    let top = run(root, &["rev-parse", "--show-toplevel"])
        .map(|out| PathBuf::from(text(&out).trim()))
        .ok_or(GitError::WorktreeFailed)?;
    let inside = root
        .canonicalize()
        .ok()
        .and_then(|full| {
            top.canonicalize()
                .ok()
                .and_then(|top| full.strip_prefix(top).ok().map(Path::to_path_buf))
        })
        .ok_or(GitError::WorktreeFailed)?;
    let folder = base.join(name);

    if !folder.join(".git").exists() {
        fs::create_dir_all(base).map_err(|_| GitError::WorktreeFailed)?;

        let branch = format!("codexis/{name}");
        let path = folder.to_string_lossy();
        // * A branch left from an earlier worktree of this name is reused instead of failing.
        let created = run(&top, &["worktree", "add", "-b", &branch, &path]).is_some()
            || run(&top, &["worktree", "add", &path, &branch]).is_some();

        if !created {
            return Err(GitError::WorktreeFailed);
        }
    }

    Ok(folder.join(inside))
}

#[cfg(test)]
#[path = "../tests/unit/git.rs"]
mod tests;
