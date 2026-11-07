//! Git history of the open project (commit log, files of a commit, history of a file, per-line blame, branch compare) through the `git` command.
//! Every name from the front end is checked before it reaches git (a ref cannot be read as an option, a path stays inside the workspace).
//! Reading never changes the repository; only `checkout`, `merge` and `pull` do, and a merge that conflicts is aborted at once.

use crate::validation;
use crate::workspace::{self, Workspace, WorkspaceError};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;
use std::time::{Duration, Instant};

/// Most commits one call returns.
pub const MAX_LOG_LIMIT: u32 = 200;
/// Longest unified diff of one file, in bytes; the rest is cut and `truncated` is set.
pub const MAX_DIFF_BYTES: usize = 512 * 1024;
/// Longest `git` output read for a log or a blame, in bytes.
const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const FIELD_SEPARATOR: char = '\x1f';
const RECORD_SEPARATOR: char = '\x1e';
const MIN_HASH_LENGTH: usize = 7;
const MAX_HASH_LENGTH: usize = 40;
const SHORT_HASH_LENGTH: usize = 7;
/// Longest a pull may run, in seconds; the network can hang.
const PULL_TIMEOUT_SECONDS: u64 = 120;
/// Longest a checkout or a merge may run, in seconds.
const WRITE_TIMEOUT_SECONDS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Local,
    Remote,
    Tag,
    Head,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix seconds.
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<RefLabel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    /// One letter of git: A, M, D, R, C or T.
    pub status: String,
    /// Path before a rename or copy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    /// None for a binary file.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub diff: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// 1-based line of the file.
    pub line: u32,
    /// All zeros while the line is not committed.
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    /// Unix seconds; 0 while the line is not committed.
    pub timestamp: i64,
    pub subject: String,
    pub committed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchesInfo {
    pub git: bool,
    pub current: Option<String>,
    pub local: Vec<String>,
    pub remotes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCompare {
    /// Commits `head` has that `base` does not.
    pub ahead: u32,
    /// Commits `base` has that `head` does not.
    pub behind: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitHistoryError {
    Workspace(WorkspaceError),
    GitMissing,
    NotRepository,
    BadRef,
    BadHash,
    NotFound,
    NotTracked,
    TooLarge,
    NotText,
    Failed,
    CheckoutFailed,
    MergeConflict,
    MergeFailed,
    PullFailed,
    NoUpstream,
}

impl GitHistoryError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Workspace(error) => error.message(),
            Self::GitMissing => "git.not_installed",
            Self::NotRepository => "git.not_repository",
            Self::BadRef => "git.bad_ref",
            Self::BadHash => "git.bad_hash",
            Self::NotFound => "git.not_found",
            Self::NotTracked => "git.not_tracked",
            Self::TooLarge => "git.too_large",
            Self::NotText => "git.not_text",
            Self::Failed => "git.history_failed",
            Self::CheckoutFailed => "git.checkout_failed",
            Self::MergeConflict => "git.merge_conflict",
            Self::MergeFailed => "git.merge_failed",
            Self::PullFailed => "git.pull_failed",
            Self::NoUpstream => "git.no_upstream",
        }
    }
}

impl std::fmt::Display for GitHistoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for GitHistoryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Workspace(error) => Some(error),
            _ => None,
        }
    }
}

impl From<WorkspaceError> for GitHistoryError {
    fn from(error: WorkspaceError) -> Self {
        Self::Workspace(error)
    }
}

type Result<T> = std::result::Result<T, GitHistoryError>;

fn command(dir: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");

    command
        .arg("--no-optional-locks")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        // * File names are data: `*`, `[a]` or `:(top)x` must never act as pathspec magic.
        .env("GIT_LITERAL_PATHSPECS", "1");

    command
}

fn spawn_error(error: &std::io::Error) -> GitHistoryError {
    if error.kind() == ErrorKind::NotFound {
        GitHistoryError::GitMissing
    } else {
        GitHistoryError::Failed
    }
}

/// Stdout of `git <args>`; any failure of git itself is `Failed`.
fn run(dir: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = command(dir, args)
        .output()
        .map_err(|error| spawn_error(&error))?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(GitHistoryError::Failed)
    }
}

/// Stdout of `git <args>` read up to `limit` bytes (the process is stopped after that); the flag says the output was cut.
fn run_limited(dir: &Path, args: &[&str], limit: usize) -> Result<(Vec<u8>, bool)> {
    let mut child = command(dir, args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| spawn_error(&error))?;
    let mut bytes = Vec::new();
    let read = match child.stdout.take() {
        Some(stdout) => stdout
            // * One byte more than the limit tells "exactly at the limit" from "cut".
            .take(u64::try_from(limit).unwrap_or(u64::MAX).saturating_add(1))
            .read_to_end(&mut bytes),
        None => Ok(0),
    };
    let truncated = bytes.len() > limit;

    if truncated {
        bytes.truncate(limit);
        // * Stopping a process that already exited is not an error worth reporting.
        let _ = child.kill();
    }

    let status = child.wait().map_err(|_| GitHistoryError::Failed)?;

    read.map_err(|_| GitHistoryError::Failed)?;

    if truncated || status.success() {
        Ok((bytes, truncated))
    } else {
        Err(GitHistoryError::Failed)
    }
}

/// Exit status of `git <args>` with its output dropped; the process is killed after `timeout_seconds`.
fn run_status(dir: &Path, args: &[&str], timeout_seconds: u64) -> Result<ExitStatus> {
    let mut child = command(dir, args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| spawn_error(&error))?;
    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                // * Stopping a process that already exited is not an error worth reporting.
                let _ = child.kill();
                let _ = child.wait();

                return Err(GitHistoryError::Failed);
            }
        }
    }
}

/// A name that is an existing local branch.
fn checked_local_branch(dir: &Path, name: &str) -> Result<()> {
    validation::branch_name(name).map_err(|_| GitHistoryError::BadRef)?;

    let reference = format!("refs/heads/{name}");

    run(
        dir,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            "--end-of-options",
            &reference,
        ],
    )
    .map(|_| ())
    .map_err(|_| GitHistoryError::NotFound)
}

/// The folder is inside a git work tree; tells "git is missing" and "not a repository" apart from other failures.
fn ensure_repository(dir: &Path) -> Result<()> {
    let output = command(dir, &["rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|error| spawn_error(&error))?;

    if output.status.success() && output.stdout.trim_ascii() == b"true" {
        Ok(())
    } else {
        Err(GitHistoryError::NotRepository)
    }
}

fn text(bytes: &[u8]) -> std::borrow::Cow<'_, str> {
    String::from_utf8_lossy(bytes)
}

/// A branch, tag or remote branch name that exists and names a commit; it can never be read as an option.
fn checked_ref(dir: &Path, name: &str) -> Result<()> {
    validation::branch_name(name).map_err(|_| GitHistoryError::BadRef)?;

    let target = format!("{name}^{{commit}}");

    run(
        dir,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &target,
        ],
    )
    .map(|_| ())
    .map_err(|_| GitHistoryError::NotFound)
}

fn is_hash(value: &str) -> bool {
    (MIN_HASH_LENGTH..=MAX_HASH_LENGTH).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// A commit hash (7 to 40 hex digits) that exists.
fn checked_hash(dir: &Path, hash: &str) -> Result<()> {
    if !is_hash(hash) {
        return Err(GitHistoryError::BadHash);
    }

    let target = format!("{hash}^{{commit}}");

    run(
        dir,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            &target,
        ],
    )
    .map(|_| ())
    .map_err(|_| GitHistoryError::NotFound)
}

fn log_format() -> String {
    let fields = ["%H", "%h", "%an", "%ae", "%at", "%P", "%s", "%D"].join("%x1f");

    format!("--format=%x1e{fields}")
}

/// Labels of one `%D` value (`HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`).
fn parse_refs(decoration: &str) -> Vec<RefLabel> {
    let mut labels = Vec::new();

    for part in decoration.split(", ").map(str::trim) {
        if part.is_empty() {
            continue;
        }

        if let Some(target) = part.strip_prefix("HEAD -> ") {
            labels.push(RefLabel {
                name: "HEAD".to_string(),
                kind: RefKind::Head,
            });

            if let Some(name) = target.strip_prefix("refs/heads/") {
                labels.push(RefLabel {
                    name: name.to_string(),
                    kind: RefKind::Local,
                });
            }
        } else if part == "HEAD" {
            labels.push(RefLabel {
                name: "HEAD".to_string(),
                kind: RefKind::Head,
            });
        } else if let Some(name) = part
            .strip_prefix("tag: ")
            .map(|tag| tag.strip_prefix("refs/tags/").unwrap_or(tag))
        {
            labels.push(RefLabel {
                name: name.to_string(),
                kind: RefKind::Tag,
            });
        } else if let Some(name) = part.strip_prefix("refs/heads/") {
            labels.push(RefLabel {
                name: name.to_string(),
                kind: RefKind::Local,
            });
        } else if let Some(name) = part.strip_prefix("refs/remotes/") {
            labels.push(RefLabel {
                name: name.to_string(),
                kind: RefKind::Remote,
            });
        }
    }

    labels
}

fn parse_commits(output: &[u8]) -> Vec<CommitInfo> {
    text(output)
        .split(RECORD_SEPARATOR)
        .filter_map(|record| {
            let mut fields = record.trim_end_matches('\n').split(FIELD_SEPARATOR);
            let hash = fields.next().filter(|hash| !hash.is_empty())?;
            let short_hash = fields.next()?;
            let author_name = fields.next()?;
            let author_email = fields.next()?;
            let timestamp = fields.next()?.parse().ok()?;
            let parents = fields.next()?;
            let subject = fields.next()?;
            let decoration = fields.next().unwrap_or("");

            Some(CommitInfo {
                hash: hash.to_string(),
                short_hash: short_hash.to_string(),
                subject: subject.to_string(),
                author_name: author_name.to_string(),
                author_email: author_email.to_string(),
                timestamp,
                parents: parents.split_whitespace().map(str::to_string).collect(),
                refs: parse_refs(decoration),
            })
        })
        .collect()
}

/// What `git show --raw --numstat -z` prints: one raw record per file (`:<modes> <ids> <status>`, then the path, or the old and new path of a rename), then one numstat record per file.
fn parse_commit_files(output: &str) -> Vec<CommitFile> {
    let mut entries = output.split('\0').filter(|entry| !entry.is_empty());
    let mut files: Vec<CommitFile> = Vec::new();
    let mut counts: HashMap<String, (Option<u32>, Option<u32>)> = HashMap::new();

    while let Some(entry) = entries.next() {
        if entry.starts_with(':') {
            let status = entry.rsplit(' ').next().unwrap_or("");
            let letter = status.chars().next().map(String::from).unwrap_or_default();

            if matches!(letter.as_str(), "R" | "C") {
                if let (Some(old), Some(new)) = (entries.next(), entries.next()) {
                    files.push(commit_file(letter, new, Some(old)));
                }
            } else if let Some(path) = entries.next() {
                files.push(commit_file(letter, path, None));
            }

            continue;
        }

        let mut parts = entry.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let key = if path.is_empty() {
            // * A rename lists the old and new path as separate entries after an empty one.
            let _old = entries.next();

            match entries.next() {
                Some(new) => new,
                None => continue,
            }
        } else {
            path
        };

        counts.insert(
            key.to_string(),
            (added.parse::<u32>().ok(), removed.parse::<u32>().ok()),
        );
    }

    for file in &mut files {
        let (additions, deletions) = counts.get(&file.path).copied().unwrap_or((None, None));

        file.additions = additions;
        file.deletions = deletions;
    }

    files
}

fn commit_file(status: String, path: &str, old_path: Option<&str>) -> CommitFile {
    CommitFile {
        path: path.to_string(),
        status,
        old_path: old_path.map(str::to_string),
        additions: None,
        deletions: None,
    }
}

fn clamp_limit(limit: u32) -> String {
    limit.clamp(1, MAX_LOG_LIMIT).to_string()
}

/// Most bytes (estimated) the history cache keeps.
const MAX_CACHE_BYTES: usize = 8 * 1024 * 1024;
/// Most entries the history cache keeps.
const MAX_CACHE_ENTRIES: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum CacheKey {
    /// `state` is the repository state (see `repo_state`): a new commit, checkout, merge or pull gives a new key, so an old entry is simply never found again and ages out.
    Log {
        root: PathBuf,
        branch: Option<String>,
        limit: u32,
        skip: u32,
        state: u64,
    },
    /// A commit never changes, so these keys carry no repository state.
    CommitFiles {
        root: PathBuf,
        hash: String,
    },
    CommitFileDiff {
        root: PathBuf,
        hash: String,
        path: String,
    },
    Branches {
        root: PathBuf,
        state: u64,
    },
    Blame {
        root: PathBuf,
        path: String,
        state: u64,
        modified: Option<SystemTime>,
        size: u64,
    },
}

#[derive(Debug, Clone)]
enum CacheValue {
    Log(Vec<CommitInfo>),
    CommitFiles(Vec<CommitFile>),
    CommitFileDiff(FileDiff),
    Branches(BranchesInfo),
    Blame(Arc<Vec<BlameLine>>),
}

impl CacheValue {
    /// Rough size in bytes, enough to keep the cache bounded.
    fn weight(&self) -> usize {
        match self {
            Self::Log(commits) => commits
                .iter()
                .map(|commit| {
                    256 + commit.subject.len()
                        + commit.author_name.len()
                        + commit.author_email.len()
                        + commit.parents.len() * 48
                        + commit
                            .refs
                            .iter()
                            .map(|label| 32 + label.name.len())
                            .sum::<usize>()
                })
                .sum(),
            Self::CommitFiles(files) => files.iter().map(|file| 96 + file.path.len() * 2).sum(),
            Self::CommitFileDiff(diff) => 64 + diff.diff.len(),
            Self::Branches(info) => info
                .local
                .iter()
                .chain(&info.remotes)
                .map(|name| 32 + name.len())
                .sum(),
            Self::Blame(lines) => lines
                .iter()
                .map(|line| 160 + line.author_name.len() + line.subject.len())
                .sum(),
        }
    }
}

#[derive(Default)]
struct CacheInner {
    /// Most recently used first.
    entries: Vec<(CacheKey, CacheValue, usize)>,
    bytes: usize,
}

/// Small least-recently-used cache of history answers, shared by every call (cheap to clone). Bounded by `MAX_CACHE_BYTES` and `MAX_CACHE_ENTRIES`.
#[derive(Clone, Default)]
pub struct HistoryCache(Arc<Mutex<CacheInner>>);

impl HistoryCache {
    fn lock(&self) -> std::sync::MutexGuard<'_, CacheInner> {
        // * The cache holds only copies, so data left by a panicked thread is still safe to use.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn get(&self, key: &CacheKey) -> Option<CacheValue> {
        let mut inner = self.lock();
        let index = inner
            .entries
            .iter()
            .position(|(known, _, _)| known == key)?;
        let entry = inner.entries.remove(index);
        let value = entry.1.clone();

        inner.entries.insert(0, entry);

        Some(value)
    }

    fn put(&self, key: CacheKey, value: CacheValue) {
        let weight = value.weight();

        // * One answer larger than half the cache would push everything else out.
        if weight > MAX_CACHE_BYTES / 2 {
            return;
        }

        let mut inner = self.lock();

        if let Some(index) = inner.entries.iter().position(|(known, _, _)| *known == key) {
            let (_, _, old) = inner.entries.remove(index);

            inner.bytes -= old;
        }

        inner.entries.insert(0, (key, value, weight));
        inner.bytes += weight;

        while inner.bytes > MAX_CACHE_BYTES || inner.entries.len() > MAX_CACHE_ENTRIES {
            let Some((_, _, evicted)) = inner.entries.pop() else {
                break;
            };

            inner.bytes -= evicted;
        }
    }

    /// Entries held now (for tests).
    pub fn len(&self) -> usize {
        self.lock().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Stdout of a command that exits 0 or 1 (`show-ref` and `symbolic-ref` use 1 for "nothing to show"); any other exit is not a repository.
fn run_tolerant(dir: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = command(dir, args)
        .output()
        .map_err(|error| spawn_error(&error))?;

    match output.status.code() {
        Some(0 | 1) => Ok(output.stdout),
        _ => Err(GitHistoryError::NotRepository),
    }
}

/// A fingerprint of everything history answers depend on: `HEAD`, every branch, remote branch and tag with its commit, and which branch is checked out.
/// Two processes, far cheaper than the answers they guard; any commit, checkout, merge, fetch or pull changes it. Also tells "git is missing" and "not a repository".
fn repo_state(dir: &Path) -> Result<u64> {
    let refs = run_tolerant(dir, &["show-ref", "--head"])?;
    let branch = run_tolerant(dir, &["symbolic-ref", "-q", "HEAD"])?;
    let mut hasher = DefaultHasher::new();

    refs.hash(&mut hasher);
    branch.hash(&mut hasher);

    Ok(hasher.finish())
}

/// The `git` folder is the project root; a folder inside a larger repository works too (paths are relative to it).
/// With a cache, repeated questions about the same repository state are answered without running the real command.
pub struct GitHistory<'a> {
    workspace: &'a Workspace,
    cache: Option<&'a HistoryCache>,
}

impl<'a> GitHistory<'a> {
    pub fn new(workspace: &'a Workspace) -> Self {
        Self {
            workspace,
            cache: None,
        }
    }

    pub fn with_cache(workspace: &'a Workspace, cache: &'a HistoryCache) -> Self {
        Self {
            workspace,
            cache: Some(cache),
        }
    }

    fn root(&self) -> &Path {
        self.workspace.root()
    }

    /// An allowed path of the workspace as git gets it: relative to the project root, never an option.
    fn pathspec(&self, path: &str) -> Result<String> {
        let relative = self.workspace.allowed_relative(path)?;

        Ok(format!("./{relative}"))
    }

    /// The repository state when a cache is in use (None without one, so no extra process runs).
    fn state_if_cached(&self) -> Result<Option<u64>> {
        self.cache.map(|_| repo_state(self.root())).transpose()
    }

    fn lookup(&self, key: &CacheKey) -> Option<CacheValue> {
        self.cache.and_then(|cache| cache.get(key))
    }

    fn store(&self, key: CacheKey, value: CacheValue) {
        if let Some(cache) = self.cache {
            cache.put(key, value);
        }
    }

    /// Newest commits first. `branch` None is the current `HEAD`; a repository without commits gives an empty list.
    /// One `git log` process: the labels come from the same output (`%D`), nothing is asked per commit.
    pub fn log(&self, branch: Option<&str>, limit: u32, skip: u32) -> Result<Vec<CommitInfo>> {
        let root = self.root();

        if let Some(name) = branch {
            validation::branch_name(name).map_err(|_| GitHistoryError::BadRef)?;
        }

        let limit = limit.clamp(1, MAX_LOG_LIMIT);
        let key = match self.state_if_cached()? {
            Some(state) => {
                let key = CacheKey::Log {
                    root: root.to_path_buf(),
                    branch: branch.map(str::to_string),
                    limit,
                    skip,
                    state,
                };

                if let Some(CacheValue::Log(commits)) = self.lookup(&key) {
                    return Ok(commits);
                }

                Some(key)
            }
            None => None,
        };
        let format = log_format();
        let result = run(
            root,
            &[
                "log",
                "--decorate=full",
                "--max-count",
                &limit.to_string(),
                "--skip",
                &skip.to_string(),
                &format,
                "--end-of-options",
                branch.unwrap_or("HEAD"),
            ],
        );
        let commits = match result {
            Ok(output) => parse_commits(&output),
            Err(GitHistoryError::Failed) => {
                ensure_repository(root)?;

                match branch {
                    Some(name) => {
                        checked_ref(root, name)?;

                        return Err(GitHistoryError::Failed);
                    }
                    // * A repository without commits has no `HEAD` to log.
                    None if run(root, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() => {
                        Vec::new()
                    }
                    None => return Err(GitHistoryError::Failed),
                }
            }
            Err(error) => return Err(error),
        };

        if let Some(key) = key {
            self.store(key, CacheValue::Log(commits.clone()));
        }

        Ok(commits)
    }

    /// Files a commit changed (against its first parent), with the lines added and removed. One `git show` process; a commit never changes, so the answer is cached for good.
    pub fn commit_files(&self, hash: &str) -> Result<Vec<CommitFile>> {
        let root = self.root();

        if !is_hash(hash) {
            return Err(GitHistoryError::BadHash);
        }

        let key = CacheKey::CommitFiles {
            root: root.to_path_buf(),
            hash: hash.to_ascii_lowercase(),
        };

        if let Some(CacheValue::CommitFiles(files)) = self.lookup(&key) {
            return Ok(files);
        }

        let target = format!("{hash}^{{commit}}");
        let output = run(
            root,
            &[
                "show",
                "--first-parent",
                "--format=",
                "--raw",
                "--numstat",
                "-z",
                "-M",
                "--relative",
                "--end-of-options",
                &target,
            ],
        )
        .map_err(|error| self.explain_hash_failure(error, hash))?;
        let files: Vec<CommitFile> = parse_commit_files(&text(&output))
            .into_iter()
            .filter(|file| !workspace::denied(&file.path))
            .collect();

        self.store(key, CacheValue::CommitFiles(files.clone()));

        Ok(files)
    }

    fn explain_hash_failure(&self, error: GitHistoryError, hash: &str) -> GitHistoryError {
        if error != GitHistoryError::Failed {
            return error;
        }

        match ensure_repository(self.root()).and_then(|()| checked_hash(self.root(), hash)) {
            Err(error) => error,
            Ok(()) => GitHistoryError::Failed,
        }
    }

    /// Unified diff of one file in a commit (against its first parent), cut at `MAX_DIFF_BYTES`. Cached for good, like the file list.
    pub fn commit_file_diff(&self, hash: &str, path: &str) -> Result<FileDiff> {
        let root = self.root();
        let pathspec = self.pathspec(path)?;

        if !is_hash(hash) {
            return Err(GitHistoryError::BadHash);
        }

        let key = CacheKey::CommitFileDiff {
            root: root.to_path_buf(),
            hash: hash.to_ascii_lowercase(),
            path: pathspec.clone(),
        };

        if let Some(CacheValue::CommitFileDiff(diff)) = self.lookup(&key) {
            return Ok(diff);
        }

        let target = format!("{hash}^{{commit}}");
        let (bytes, truncated) = run_limited(
            root,
            &[
                "show",
                "--first-parent",
                "--format=",
                "--no-color",
                "--no-ext-diff",
                "-M",
                "--end-of-options",
                &target,
                "--",
                &pathspec,
            ],
            MAX_DIFF_BYTES,
        )
        .map_err(|error| self.explain_hash_failure(error, hash))?;
        let diff = FileDiff {
            diff: text(&bytes).into_owned(),
            truncated,
        };

        self.store(key, CacheValue::CommitFileDiff(diff.clone()));

        Ok(diff)
    }

    /// Commits that touched a file, following renames, newest first.
    pub fn file_history(&self, path: &str, limit: u32, skip: u32) -> Result<Vec<CommitInfo>> {
        let root = self.root();
        let pathspec = self.pathspec(path)?;
        let format = log_format();
        let result = run(
            root,
            &[
                "log",
                "--follow",
                "--decorate=full",
                "--max-count",
                &clamp_limit(limit),
                "--skip",
                &skip.to_string(),
                &format,
                "--end-of-options",
                "HEAD",
                "--",
                &pathspec,
            ],
        );

        match result {
            Ok(output) => Ok(parse_commits(&output)),
            Err(GitHistoryError::Failed) => {
                ensure_repository(root)?;

                // * A repository without commits has no history.
                if run(root, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() {
                    Ok(Vec::new())
                } else {
                    Err(GitHistoryError::Failed)
                }
            }
            Err(error) => Err(error),
        }
    }

    /// Who last changed each line of the file as it is on disk; lines not committed yet have `committed: false`.
    /// The answer is cached under the repository state plus the file's modification time and size, so editing the file, committing or switching branch asks git again.
    pub fn blame(&self, path: &str) -> Result<Arc<Vec<BlameLine>>> {
        let root = self.root();
        let pathspec = self.pathspec(path)?;
        // * Also the "is this a repository" check, before anything touches the file.
        let state = repo_state(root)?;
        let stat = fs::metadata(root.join(&pathspec)).ok();
        let key = stat.as_ref().map(|stat| CacheKey::Blame {
            root: root.to_path_buf(),
            path: pathspec.clone(),
            state,
            modified: stat.modified().ok(),
            size: stat.len(),
        });

        if let Some(CacheValue::Blame(lines)) = key.as_ref().and_then(|key| self.lookup(key)) {
            return Ok(lines);
        }

        // * The guarded read refuses denied names, links out of the root, binary files and files over the read limit.
        self.workspace.read(path)?;

        let (bytes, truncated) = run_limited(
            root,
            &["blame", "--porcelain", "--", &pathspec],
            MAX_OUTPUT_BYTES,
        )
        .map_err(|error| {
            // * A file git does not know (new, ignored) has no blame.
            if error == GitHistoryError::Failed
                && run(root, &["ls-files", "--error-unmatch", "--", &pathspec]).is_err()
            {
                GitHistoryError::NotTracked
            } else {
                error
            }
        })?;

        if truncated {
            return Err(GitHistoryError::TooLarge);
        }

        let lines = Arc::new(parse_blame(&text(&bytes)));

        if let Some(key) = key {
            self.store(key, CacheValue::Blame(Arc::clone(&lines)));
        }

        Ok(lines)
    }

    /// Current branch, local branches and remote branches in one `for-each-ref`; `git` is false outside a repository.
    pub fn branches_info(&self) -> BranchesInfo {
        let root = self.root();
        let key = self
            .state_if_cached()
            .ok()
            .flatten()
            .map(|state| CacheKey::Branches {
                root: root.to_path_buf(),
                state,
            });

        if let Some(CacheValue::Branches(info)) = key.as_ref().and_then(|key| self.lookup(key)) {
            return info;
        }

        let Ok(output) = run(
            root,
            &[
                "for-each-ref",
                "--format=%(HEAD)%09%(refname)",
                "refs/heads",
                "refs/remotes",
            ],
        ) else {
            return BranchesInfo {
                git: false,
                current: None,
                local: Vec::new(),
                remotes: Vec::new(),
            };
        };
        let mut info = BranchesInfo {
            git: true,
            current: None,
            local: Vec::new(),
            remotes: Vec::new(),
        };

        for row in text(&output).lines() {
            let (marker, name) = row.split_once('\t').unwrap_or(("", row));

            if let Some(branch) = name.strip_prefix("refs/heads/") {
                if marker == "*" {
                    info.current = Some(branch.to_string());
                }

                info.local.push(branch.to_string());
            } else if let Some(remote) = name.strip_prefix("refs/remotes/") {
                if !remote.ends_with("/HEAD") {
                    info.remotes.push(remote.to_string());
                }
            }
        }

        if let Some(key) = key {
            self.store(key, CacheValue::Branches(info.clone()));
        }

        info
    }

    /// The checked-out local branch.
    fn current_branch(&self) -> Result<String> {
        let output = run(self.root(), &["symbolic-ref", "--short", "-q", "HEAD"])?;

        Ok(text(&output).trim().to_string())
    }

    /// Switches to an existing local branch; git refuses when local changes would be lost. Nothing is cached about the old state: the next read sees the new repository state.
    pub fn checkout(&self, branch: &str) -> Result<String> {
        let root = self.root();

        ensure_repository(root)?;
        checked_local_branch(root, branch)?;

        let status = run_status(
            root,
            &["switch", "--quiet", "--end-of-options", branch],
            WRITE_TIMEOUT_SECONDS,
        )?;

        if !status.success() {
            return Err(GitHistoryError::CheckoutFailed);
        }

        self.current_branch()
    }

    /// Merges an existing local branch into the current one; a merge that conflicts is aborted at once so the folder stays clean.
    pub fn merge(&self, branch: &str) -> Result<String> {
        let root = self.root();

        ensure_repository(root)?;
        checked_local_branch(root, branch)?;

        let status = run_status(
            root,
            &["merge", "--no-edit", "--quiet", "--end-of-options", branch],
            WRITE_TIMEOUT_SECONDS,
        )?;

        if !status.success() {
            let conflicted = run(root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok();

            if conflicted {
                run_status(root, &["merge", "--abort"], WRITE_TIMEOUT_SECONDS)?;

                return Err(GitHistoryError::MergeConflict);
            }

            return Err(GitHistoryError::MergeFailed);
        }

        self.current_branch()
    }

    /// Fast-forwards the current branch from its upstream; never creates a merge commit.
    pub fn pull(&self) -> Result<String> {
        let root = self.root();

        ensure_repository(root)?;

        if run(
            root,
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        )
        .is_err()
        {
            return Err(GitHistoryError::NoUpstream);
        }

        let status = run_status(
            root,
            &["pull", "--ff-only", "--quiet"],
            PULL_TIMEOUT_SECONDS,
        )?;

        if !status.success() {
            return Err(GitHistoryError::PullFailed);
        }

        self.current_branch()
    }

    /// Commits `head` is ahead of and behind `base`: one `rev-list --left-right --count`.
    pub fn branch_compare(&self, base: &str, head: &str) -> Result<BranchCompare> {
        let root = self.root();

        validation::branch_name(base).map_err(|_| GitHistoryError::BadRef)?;
        validation::branch_name(head).map_err(|_| GitHistoryError::BadRef)?;

        let range = format!("{base}...{head}");
        let output = match run(
            root,
            // * The `--` after the range keeps git from taking a name for a file.
            &[
                "rev-list",
                "--left-right",
                "--count",
                "--end-of-options",
                &range,
                "--",
            ],
        ) {
            Ok(output) => output,
            Err(GitHistoryError::Failed) => {
                ensure_repository(root)?;
                checked_ref(root, base)?;
                checked_ref(root, head)?;

                return Err(GitHistoryError::Failed);
            }
            Err(error) => return Err(error),
        };
        let output = text(&output);
        let mut counts = output.split_whitespace().map(str::parse::<u32>);

        match (counts.next(), counts.next()) {
            (Some(Ok(behind)), Some(Ok(ahead))) => Ok(BranchCompare { ahead, behind }),
            _ => Err(GitHistoryError::Failed),
        }
    }
}

/// Parses `git blame --porcelain`: a header per line (`<hash> <original> <final> [<group size>]`), the commit's details the first time it shows, then the line itself behind a tab.
fn parse_blame(output: &str) -> Vec<BlameLine> {
    struct Details {
        author_name: String,
        timestamp: i64,
        subject: String,
    }

    let mut details: HashMap<&str, Details> = HashMap::new();
    let mut lines = Vec::new();
    let mut current: Option<(&str, u32)> = None;

    for row in output.lines() {
        if row.starts_with('\t') {
            if let Some((hash, line)) = current.take() {
                let committed = hash.bytes().any(|byte| byte != b'0');
                let known = details.get(hash);

                lines.push(BlameLine {
                    line,
                    hash: hash.to_string(),
                    short_hash: hash.chars().take(SHORT_HASH_LENGTH).collect(),
                    author_name: known
                        .filter(|_| committed)
                        .map(|known| known.author_name.clone())
                        .unwrap_or_default(),
                    timestamp: known
                        .filter(|_| committed)
                        .map_or(0, |known| known.timestamp),
                    subject: known
                        .filter(|_| committed)
                        .map(|known| known.subject.clone())
                        .unwrap_or_default(),
                    committed,
                });
            }

            continue;
        }

        let mut words = row.split(' ');
        let first = words.next().unwrap_or("");

        if is_full_hash(first) {
            let final_line = words.nth(1).and_then(|word| word.parse::<u32>().ok());

            if let Some(final_line) = final_line {
                current = Some((first, final_line));
                details.entry(first).or_insert(Details {
                    author_name: String::new(),
                    timestamp: 0,
                    subject: String::new(),
                });
            }

            continue;
        }

        let Some((hash, _)) = current else {
            continue;
        };
        let Some(entry) = details.get_mut(hash) else {
            continue;
        };

        if let Some(name) = row.strip_prefix("author ") {
            entry.author_name = name.to_string();
        } else if let Some(time) = row.strip_prefix("author-time ") {
            entry.timestamp = time.parse().unwrap_or(0);
        } else if let Some(summary) = row.strip_prefix("summary ") {
            entry.subject = summary.to_string();
        }
    }

    lines
}

fn is_full_hash(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
#[path = "../tests/unit/git_history.rs"]
mod tests;
