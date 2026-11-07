use super::*;
use std::fs;
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(["-c", "user.name=Ann", "-c", "user.email=ann@example.com"])
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git runs");

    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn commit(dir: &Path, file: &str, content: &str, message: &str) {
    fs::write(dir.join(file), content).unwrap();
    git(dir, &["add", "--", file]);
    git(dir, &["commit", "-q", "-m", message]);
}

fn repo() -> TempDir {
    let dir = TempDir::new().unwrap();

    git(dir.path(), &["init", "-q", "-b", "main"]);
    commit(dir.path(), "a.txt", "one\n", "first");
    commit(dir.path(), "a.txt", "one\ntwo\n", "second");
    commit(dir.path(), "b.txt", "bee\n", "third");

    dir
}

fn subjects(commits: &[CommitInfo]) -> Vec<&str> {
    commits
        .iter()
        .map(|commit| commit.subject.as_str())
        .collect()
}

#[test]
fn log_lists_newest_first_and_honours_limit_and_skip() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);
    let all = history.log(None, 50, 0).unwrap();

    assert_eq!(subjects(&all), ["third", "second", "first"]);
    assert_eq!(all[0].author_name, "Ann");
    assert_eq!(all[0].author_email, "ann@example.com");
    assert_eq!(all[0].parents, [all[1].hash.clone()]);
    assert!(all[2].parents.is_empty());
    assert!(all[0].hash.starts_with(&all[0].short_hash));
    assert!(all[0].timestamp > 0);
    assert_eq!(subjects(&history.log(None, 1, 1).unwrap()), ["second"]);
    // * 0 is raised to 1 and a huge value is lowered to the maximum.
    assert_eq!(history.log(None, 0, 0).unwrap().len(), 1);
    assert_eq!(history.log(None, u32::MAX, 0).unwrap().len(), 3);
}

#[test]
fn log_labels_head_branch_tag_and_remote() {
    let dir = repo();

    git(dir.path(), &["tag", "v1"]);
    git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", "HEAD"],
    );

    let ws = Workspace::open(dir.path()).unwrap();
    let refs = GitHistory::new(&ws).log(None, 1, 0).unwrap().remove(0).refs;
    let has = |name: &str, kind| {
        refs.contains(&RefLabel {
            name: name.to_string(),
            kind,
        })
    };

    assert!(has("HEAD", RefKind::Head));
    assert!(has("main", RefKind::Local));
    assert!(has("v1", RefKind::Tag));
    assert!(has("origin/main", RefKind::Remote));
}

#[test]
fn log_of_another_branch_and_of_an_empty_repository() {
    let dir = repo();

    git(dir.path(), &["checkout", "-q", "-b", "topic", "HEAD~1"]);
    commit(dir.path(), "c.txt", "c\n", "on topic");
    git(dir.path(), &["checkout", "-q", "main"]);

    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);

    assert_eq!(
        subjects(&history.log(Some("topic"), 10, 0).unwrap()),
        ["on topic", "second", "first"]
    );

    let empty = TempDir::new().unwrap();

    git(empty.path(), &["init", "-q", "-b", "main"]);

    let ws = Workspace::open(empty.path()).unwrap();

    assert_eq!(GitHistory::new(&ws).log(None, 10, 0).unwrap(), Vec::new());
}

#[test]
fn refs_that_look_like_options_or_do_not_exist_are_refused() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);

    for name in ["--output=/tmp/x", "-n1", "a b", "a\nb", "", "--all", "x..y"] {
        assert_eq!(
            history.log(Some(name), 10, 0),
            Err(GitHistoryError::BadRef),
            "{name:?}"
        );
    }

    assert_eq!(
        history.log(Some("nope"), 10, 0),
        Err(GitHistoryError::NotFound)
    );
    assert_eq!(
        history.branch_compare("--version", "main"),
        Err(GitHistoryError::BadRef)
    );
    assert_eq!(
        history.branch_compare("main", "nope"),
        Err(GitHistoryError::NotFound)
    );
}

#[test]
fn a_branch_named_like_an_option_is_never_read_as_one() {
    let dir = repo();

    // * Git itself refuses to create `-x`, so the name can only reach us as text, and the check stops it.
    let ws = Workspace::open(dir.path()).unwrap();

    assert_eq!(
        GitHistory::new(&ws).log(Some("-x"), 1, 0),
        Err(GitHistoryError::BadRef)
    );
}

#[test]
fn outside_a_repository_the_error_says_so() {
    let dir = TempDir::new().unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);

    assert_eq!(
        history.log(None, 10, 0),
        Err(GitHistoryError::NotRepository)
    );
    assert_eq!(history.blame("a.txt"), Err(GitHistoryError::NotRepository));
    assert_eq!(
        GitHistoryError::NotRepository.to_string(),
        "git.not_repository"
    );
    assert!(!history.branches_info().git);
}

#[test]
fn commit_files_have_status_and_numstat() {
    let dir = repo();

    fs::write(dir.path().join("a.txt"), "one\nTWO\nthree\n").unwrap();
    fs::write(dir.path().join("bin.dat"), [0u8, 1, 2]).unwrap();
    fs::write(dir.path().join("new.txt"), "n\n").unwrap();
    git(dir.path(), &["rm", "-q", "b.txt"]);
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-q", "-m", "mixed"]);

    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);
    let head = history.log(None, 1, 0).unwrap().remove(0);
    let files = history.commit_files(&head.hash).unwrap();
    let file = |path: &str| files.iter().find(|file| file.path == path).unwrap();

    assert_eq!(files.len(), 4);
    assert_eq!(file("a.txt").status, "M");
    assert_eq!(
        (file("a.txt").additions, file("a.txt").deletions),
        (Some(2), Some(1))
    );
    assert_eq!(file("b.txt").status, "D");
    assert_eq!(file("b.txt").deletions, Some(1));
    assert_eq!(file("new.txt").status, "A");
    assert_eq!(
        (file("bin.dat").additions, file("bin.dat").deletions),
        (None, None)
    );

    // * A root commit lists its files as added.
    let root = history.log(None, 10, 0).unwrap().pop().unwrap();
    let files = history.commit_files(&root.hash).unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].status, "A");

    assert_eq!(
        history.commit_files("zzzzzzz"),
        Err(GitHistoryError::BadHash)
    );
    assert_eq!(history.commit_files("abc"), Err(GitHistoryError::BadHash));
    assert_eq!(
        history.commit_files("1234567"),
        Err(GitHistoryError::NotFound)
    );
}

#[test]
fn commit_file_diff_is_one_file_and_capped() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);
    let commits = history.log(None, 10, 0).unwrap();
    let diff = history.commit_file_diff(&commits[1].hash, "a.txt").unwrap();

    assert!(!diff.truncated);
    assert!(diff.diff.contains("+two"));
    assert!(!diff.diff.contains("bee"));

    let root = history.commit_file_diff(&commits[2].hash, "a.txt").unwrap();

    assert!(root.diff.contains("+one"));

    let big = "line\n".repeat(MAX_DIFF_BYTES / 4);

    commit(dir.path(), "big.txt", &big, "big");

    let head = history.log(None, 1, 0).unwrap().remove(0);
    let diff = history.commit_file_diff(&head.hash, "big.txt").unwrap();

    assert!(diff.truncated);
    assert!(diff.diff.len() <= MAX_DIFF_BYTES);

    assert_eq!(
        history.commit_file_diff(&head.hash, "../x"),
        Err(GitHistoryError::Workspace(WorkspaceError::BadPath))
    );
    assert_eq!(
        history.commit_file_diff(&head.hash, ".git/config"),
        Err(GitHistoryError::Workspace(WorkspaceError::Denied))
    );
}

#[test]
fn file_history_follows_a_rename() {
    let dir = repo();

    git(dir.path(), &["mv", "a.txt", "renamed.txt"]);
    git(dir.path(), &["commit", "-q", "-m", "rename"]);
    commit(
        dir.path(),
        "renamed.txt",
        "one\ntwo\nthree\n",
        "edit renamed",
    );

    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);

    assert_eq!(
        subjects(&history.file_history("renamed.txt", 10, 0).unwrap()),
        ["edit renamed", "rename", "second", "first"]
    );
    assert_eq!(
        subjects(&history.file_history("renamed.txt", 2, 1).unwrap()),
        ["rename", "second"]
    );
    assert_eq!(
        history.file_history("../etc/passwd", 10, 0),
        Err(GitHistoryError::Workspace(WorkspaceError::BadPath))
    );
}

#[test]
fn blame_maps_lines_to_commits_and_marks_uncommitted_ones() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);
    let commits = history.log(None, 10, 0).unwrap();

    fs::write(dir.path().join("a.txt"), "one\ntwo\nlocal\n").unwrap();

    let lines = history.blame("a.txt").unwrap();

    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0].line, 1);
    assert_eq!(lines[0].hash, commits[2].hash);
    assert_eq!(lines[0].subject, "first");
    assert_eq!(lines[0].author_name, "Ann");
    assert_eq!(lines[0].short_hash, commits[2].hash[..7]);
    assert!(lines[0].committed);
    assert_eq!(lines[1].hash, commits[1].hash);
    assert_eq!(lines[1].subject, "second");
    assert_eq!(lines[2].line, 3);
    assert!(!lines[2].committed);
    assert!(lines[2].hash.bytes().all(|byte| byte == b'0'));
    assert_eq!((lines[2].timestamp, lines[2].author_name.as_str()), (0, ""));
}

#[test]
fn blame_refuses_binary_big_untracked_and_denied_files() {
    let dir = repo();

    commit(dir.path(), "bin.dat", "a\0b\n", "binary");
    fs::write(
        dir.path().join("huge.txt"),
        "x".repeat(usize::try_from(workspace::MAX_READ_BYTES).unwrap() + 1),
    )
    .unwrap();
    fs::write(dir.path().join("fresh.txt"), "new\n").unwrap();

    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);

    assert_eq!(
        history.blame("bin.dat"),
        Err(GitHistoryError::Workspace(WorkspaceError::NotText))
    );
    assert_eq!(
        history.blame("huge.txt"),
        Err(GitHistoryError::Workspace(WorkspaceError::TooLarge))
    );
    assert_eq!(history.blame("fresh.txt"), Err(GitHistoryError::NotTracked));
    assert_eq!(
        history.blame(".git/HEAD"),
        Err(GitHistoryError::Workspace(WorkspaceError::Denied))
    );
}

#[test]
fn branches_info_and_compare_count_ahead_and_behind() {
    let dir = repo();

    git(dir.path(), &["checkout", "-q", "-b", "topic", "HEAD~1"]);
    commit(dir.path(), "c.txt", "c\n", "t1");
    commit(dir.path(), "d.txt", "d\n", "t2");
    commit(dir.path(), "e.txt", "e\n", "t3");
    git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", "main"],
    );
    git(
        dir.path(),
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );

    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);
    let info = history.branches_info();

    assert!(info.git);
    assert_eq!(info.current.as_deref(), Some("topic"));
    assert_eq!(info.local, ["main", "topic"]);
    assert_eq!(info.remotes, ["origin/main"]);
    assert_eq!(
        history.branch_compare("main", "topic"),
        Ok(BranchCompare {
            ahead: 3,
            behind: 1
        })
    );
    assert_eq!(
        history.branch_compare("topic", "main"),
        Ok(BranchCompare {
            ahead: 1,
            behind: 3
        })
    );
    assert_eq!(
        history.branch_compare("main", "main"),
        Ok(BranchCompare {
            ahead: 0,
            behind: 0
        })
    );
}

#[test]
fn payloads_serialize_in_camel_case() {
    let line = BlameLine {
        line: 1,
        hash: "0".repeat(40),
        short_hash: "0000000".to_string(),
        author_name: String::new(),
        timestamp: 0,
        subject: String::new(),
        committed: false,
    };
    let json = serde_json::to_value(&line).unwrap();

    assert!(json.get("shortHash").is_some());
    assert!(json.get("authorName").is_some());

    let label = serde_json::to_value(RefLabel {
        name: "x".to_string(),
        kind: RefKind::Remote,
    })
    .unwrap();

    assert_eq!(label["kind"], "remote");
}

fn current(dir: &Path) -> String {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(dir)
        .output()
        .unwrap();

    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn identify(dir: &Path) {
    git(dir, &["config", "user.name", "Ann"]);
    git(dir, &["config", "user.email", "ann@example.com"]);
}

#[test]
fn checkout_switches_to_a_local_branch_and_rejects_bad_names() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();
    let history = GitHistory::new(&ws);

    git(dir.path(), &["branch", "feature"]);

    assert_eq!(history.checkout("feature").unwrap(), "feature");
    assert_eq!(current(dir.path()), "feature");
    assert_eq!(history.checkout("main").unwrap(), "main");
    assert_eq!(history.checkout("nope"), Err(GitHistoryError::NotFound));
    assert_eq!(history.checkout("--detach"), Err(GitHistoryError::BadRef));
    assert_eq!(history.checkout("-f"), Err(GitHistoryError::BadRef));
    assert_eq!(current(dir.path()), "main");
}

#[test]
fn checkout_refuses_when_local_changes_would_be_lost() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();

    git(dir.path(), &["checkout", "-q", "-b", "feature"]);
    commit(dir.path(), "a.txt", "feature\n", "on feature");
    git(dir.path(), &["checkout", "-q", "main"]);
    fs::write(dir.path().join("a.txt"), "dirty\n").unwrap();

    assert_eq!(
        GitHistory::new(&ws).checkout("feature"),
        Err(GitHistoryError::CheckoutFailed)
    );
    assert_eq!(current(dir.path()), "main");
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "dirty\n"
    );
}

#[test]
fn merge_brings_another_branch_into_the_current_one() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();

    identify(dir.path());
    git(dir.path(), &["checkout", "-q", "-b", "feature"]);
    commit(dir.path(), "c.txt", "see\n", "feature work");
    git(dir.path(), &["checkout", "-q", "main"]);

    assert_eq!(GitHistory::new(&ws).merge("feature").unwrap(), "main");
    assert!(dir.path().join("c.txt").exists());
    assert_eq!(
        GitHistory::new(&ws).merge("nope"),
        Err(GitHistoryError::NotFound)
    );
    assert_eq!(
        GitHistory::new(&ws).merge("-s"),
        Err(GitHistoryError::BadRef)
    );
}

#[test]
fn merge_conflict_is_aborted_and_leaves_the_folder_clean() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();

    identify(dir.path());
    git(dir.path(), &["checkout", "-q", "-b", "feature"]);
    commit(dir.path(), "a.txt", "feature side\n", "feature edit");
    git(dir.path(), &["checkout", "-q", "main"]);
    commit(dir.path(), "a.txt", "main side\n", "main edit");

    assert_eq!(
        GitHistory::new(&ws).merge("feature"),
        Err(GitHistoryError::MergeConflict)
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "main side\n"
    );
    assert!(!dir.path().join(".git/MERGE_HEAD").exists());
}

#[test]
fn pull_without_an_upstream_is_reported() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();

    assert_eq!(
        GitHistory::new(&ws).pull(),
        Err(GitHistoryError::NoUpstream)
    );
}

#[test]
fn pull_fast_forwards_from_the_upstream() {
    let origin = TempDir::new().unwrap();
    let work = TempDir::new().unwrap();

    git(origin.path(), &["init", "-q", "--bare", "-b", "main"]);

    let url = origin.path().to_str().unwrap();

    git(work.path(), &["init", "-q", "-b", "main"]);
    commit(work.path(), "a.txt", "one\n", "first");
    git(work.path(), &["remote", "add", "origin", url]);
    git(work.path(), &["push", "-q", "-u", "origin", "main"]);

    let other = TempDir::new().unwrap();
    let clone_target = other.path().join("copy");

    git(
        other.path(),
        &["clone", "-q", url, clone_target.to_str().unwrap()],
    );
    commit(&clone_target, "b.txt", "bee\n", "second");
    git(&clone_target, &["push", "-q", "origin", "main"]);

    let ws = Workspace::open(work.path()).unwrap();

    assert_eq!(GitHistory::new(&ws).pull().unwrap(), "main");
    assert!(work.path().join("b.txt").exists());
}

fn cached(dir: &TempDir) -> (Workspace, HistoryCache) {
    (
        Workspace::open(dir.path()).unwrap(),
        HistoryCache::default(),
    )
}

#[test]
fn cached_log_is_reused_and_dropped_when_the_repository_changes() {
    let dir = repo();
    let (ws, cache) = cached(&dir);
    let history = GitHistory::with_cache(&ws, &cache);
    let first = history.log(None, 10, 0).unwrap();

    assert_eq!(cache.len(), 1);
    assert_eq!(history.log(None, 10, 0).unwrap(), first);
    assert_eq!(cache.len(), 1);

    // * A different page is its own entry.
    history.log(None, 10, 1).unwrap();
    assert_eq!(cache.len(), 2);

    // * A commit changes the state, so the answer is asked again and is new.
    commit(dir.path(), "z.txt", "z\n", "fourth");

    let fresh = history.log(None, 10, 0).unwrap();

    assert_eq!(fresh.len(), 4);
    assert_eq!(fresh[0].subject, "fourth");

    // * So does a checkout: the HEAD label moves to the other branch.
    git(dir.path(), &["branch", "other"]);
    git(dir.path(), &["checkout", "-q", "other"]);

    let labels = history.log(None, 1, 0).unwrap().remove(0).refs;

    assert!(labels.contains(&RefLabel {
        name: "other".to_string(),
        kind: RefKind::Local
    }));
}

#[test]
fn cached_commit_files_and_diffs_do_not_run_git_again() {
    let dir = repo();
    let (ws, cache) = cached(&dir);
    let history = GitHistory::with_cache(&ws, &cache);
    let head = history.log(None, 1, 0).unwrap().remove(0);
    let files = history.commit_files(&head.hash).unwrap();
    let diff = history.commit_file_diff(&head.hash, "b.txt").unwrap();
    let before = cache.len();

    // * A commit never changes, so even a deleted repository answers from the cache.
    fs::remove_dir_all(dir.path().join(".git")).unwrap();

    assert_eq!(history.commit_files(&head.hash).unwrap(), files);
    assert_eq!(history.commit_file_diff(&head.hash, "b.txt").unwrap(), diff);
    assert_eq!(cache.len(), before);
}

#[test]
fn cached_blame_follows_file_edits_and_commits() {
    let dir = repo();
    let (ws, cache) = cached(&dir);
    let history = GitHistory::with_cache(&ws, &cache);
    let first = history.blame("a.txt").unwrap();

    assert!(Arc::ptr_eq(&first, &history.blame("a.txt").unwrap()));

    fs::write(dir.path().join("a.txt"), "one\ntwo\nlocal edit\n").unwrap();

    let edited = history.blame("a.txt").unwrap();

    assert!(!Arc::ptr_eq(&first, &edited));
    assert!(!edited[2].committed);

    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-q", "-m", "commit edit"]);

    assert!(history.blame("a.txt").unwrap()[2].committed);
}

#[test]
fn cached_branches_info_follows_new_branches() {
    let dir = repo();
    let (ws, cache) = cached(&dir);
    let history = GitHistory::with_cache(&ws, &cache);

    assert_eq!(history.branches_info().local, ["main"]);
    assert_eq!(history.branches_info().local, ["main"]);
    assert_eq!(cache.len(), 1);

    git(dir.path(), &["branch", "extra"]);

    assert_eq!(history.branches_info().local, ["extra", "main"]);
}

#[test]
fn cache_stays_within_its_entry_limit() {
    let cache = HistoryCache::default();

    for skip in 0..u32::try_from(MAX_CACHE_ENTRIES).unwrap() + 20 {
        cache.put(
            CacheKey::Log {
                root: PathBuf::from("/x"),
                branch: None,
                limit: 1,
                skip,
                state: 0,
            },
            CacheValue::Log(Vec::new()),
        );
    }

    assert_eq!(cache.len(), MAX_CACHE_ENTRIES);

    // * An answer over half the byte budget is not kept.
    cache.put(
        CacheKey::CommitFileDiff {
            root: PathBuf::from("/x"),
            hash: "abc".to_string(),
            path: "p".to_string(),
        },
        CacheValue::CommitFileDiff(FileDiff {
            diff: "x".repeat(MAX_CACHE_BYTES),
            truncated: false,
        }),
    );

    assert_eq!(cache.len(), MAX_CACHE_ENTRIES);
}
