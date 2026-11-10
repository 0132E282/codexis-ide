use super::*;
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "protocol.file.allow=always",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git runs");

    assert!(
        status.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&status.stderr)
    );
}

fn repo() -> TempDir {
    let dir = TempDir::new().unwrap();

    git(dir.path(), &["init", "-q", "-b", "main"]);
    fs::write(dir.path().join("a.txt"), "one\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-q", "-m", "first"]);

    dir
}

#[test]
fn worktree_names_are_letters_digits_and_dashes_only() {
    assert!(valid_worktree_name("c1-a"));
    assert!(valid_worktree_name(&"a".repeat(64)));
    assert!(!valid_worktree_name(""));
    assert!(!valid_worktree_name(&"a".repeat(65)));
    assert!(!valid_worktree_name("../x"));
    assert!(!valid_worktree_name("a_b"));
}

#[test]
fn worktree_is_made_once_and_keeps_the_subfolder() {
    let dir = repo();
    let inner = dir.path().join("app");

    fs::create_dir(&inner).unwrap();
    fs::write(inner.join("b.txt"), "x\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-q", "-m", "second"]);

    let base = TempDir::new().unwrap();
    let first = ensure_worktree(&inner, base.path(), "c1").unwrap();

    assert!(first.join("b.txt").is_file());
    assert!(first.ends_with("c1/app"));
    assert_eq!(ensure_worktree(&inner, base.path(), "c1").unwrap(), first);
    assert_eq!(
        ensure_worktree(&inner, base.path(), "../x"),
        Err(GitError::WorktreeFailed)
    );
}

#[test]
fn second_worktree_name_works_and_a_non_git_folder_fails() {
    let dir = repo();
    let base = TempDir::new().unwrap();
    let first = ensure_worktree(dir.path(), base.path(), "c1").unwrap();
    let second = ensure_worktree(dir.path(), base.path(), "c2").unwrap();

    assert_ne!(first, second);
    assert!(second.join("a.txt").is_file());

    let plain = TempDir::new().unwrap();

    assert_eq!(
        ensure_worktree(plain.path(), base.path(), "c3"),
        Err(GitError::WorktreeFailed)
    );
}

#[test]
fn workspace_inside_a_larger_repository_sees_only_its_own_files() {
    let dir = repo();
    let inner = dir.path().join("app");

    fs::create_dir(&inner).unwrap();
    fs::write(inner.join("b.txt"), "one\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-q", "-m", "second"]);

    fs::write(inner.join("b.txt"), "one\ntwo\n").unwrap();
    fs::write(inner.join("new.txt"), "x\n").unwrap();
    fs::write(dir.path().join("a.txt"), "outside\n").unwrap();

    let ws = Workspace::open(&inner).unwrap();
    let files = GitRepo::new(&ws).changes().unwrap();
    let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();

    assert_eq!(paths, ["b.txt", "new.txt"]);
    assert_eq!(files[0].added, Some(1));
    assert_eq!(
        GitRepo::new(&ws).head_content("b.txt").unwrap().as_deref(),
        Some("one\n")
    );
}

#[test]
fn changes_head_and_discard() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();

    fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
    fs::write(dir.path().join("new.txt"), "x\ny\n").unwrap();
    fs::write(dir.path().join(".env"), "SECRET=1").unwrap();

    let files = GitRepo::new(&ws).changes().unwrap();

    assert_eq!(files.len(), 2, "the .env file stays hidden");
    assert_eq!(
        (files[0].path.as_str(), files[0].status, files[0].added),
        ("a.txt", ChangeStatus::Modified, Some(1))
    );
    assert_eq!(
        (files[1].path.as_str(), files[1].status, files[1].added),
        ("new.txt", ChangeStatus::Added, Some(2))
    );
    assert_eq!(
        GitRepo::new(&ws).head_content("a.txt").unwrap().as_deref(),
        Some("one\n")
    );
    assert_eq!(GitRepo::new(&ws).head_content("new.txt").unwrap(), None);

    GitRepo::new(&ws).discard("a.txt").unwrap();
    GitRepo::new(&ws).discard("new.txt").unwrap();

    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "one\n"
    );
    assert!(!dir.path().join("new.txt").exists());
}

#[test]
fn submodule_changes() {
    let inner = TempDir::new().unwrap();

    git(inner.path(), &["init", "-q", "-b", "main"]);
    fs::write(inner.path().join("b.txt"), "b\n").unwrap();
    git(inner.path(), &["add", "."]);
    git(inner.path(), &["commit", "-q", "-m", "inner"]);

    let outer = repo();

    git(
        outer.path(),
        &[
            "submodule",
            "add",
            "-q",
            inner.path().to_str().unwrap(),
            "sub",
        ],
    );
    git(outer.path(), &["commit", "-q", "-m", "add sub"]);
    fs::write(outer.path().join("sub/b.txt"), "b\nb2\n").unwrap();

    let ws = Workspace::open(outer.path()).unwrap();
    let files = GitRepo::new(&ws).changes().unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "sub/b.txt");
    assert_eq!(files[0].repo.as_deref(), Some("sub"));
    assert_eq!(
        GitRepo::new(&ws)
            .head_content("sub/b.txt")
            .unwrap()
            .as_deref(),
        Some("b\n")
    );
}

#[test]
fn commit_own_files_only() {
    let inner = TempDir::new().unwrap();

    git(inner.path(), &["init", "-q", "-b", "main"]);
    fs::write(inner.path().join("b.txt"), "b\n").unwrap();
    git(inner.path(), &["add", "."]);
    git(inner.path(), &["commit", "-q", "-m", "inner"]);

    let outer = repo();

    git(
        outer.path(),
        &[
            "submodule",
            "add",
            "-q",
            inner.path().to_str().unwrap(),
            "sub",
        ],
    );
    git(outer.path(), &["commit", "-q", "-m", "add sub"]);
    fs::write(outer.path().join("sub/b.txt"), "changed\n").unwrap();
    fs::write(outer.path().join("a.txt"), "own\n").unwrap();

    let ws = Workspace::open(outer.path()).unwrap();
    let done = GitRepo::new(&ws).commit("own change").unwrap();

    assert_eq!(done.files, 1);
    assert!(!done.hash.is_empty());

    let left = GitRepo::new(&ws).changes().unwrap();

    assert_eq!(left.len(), 1, "the submodule file is still uncommitted");
    assert_eq!(left[0].repo.as_deref(), Some("sub"));
    assert_eq!(
        GitRepo::new(&ws).commit("again").unwrap_err(),
        GitError::NothingToCommit
    );
}

#[test]
fn commit_records_a_deleted_file() {
    let dir = repo();

    git(dir.path(), &["rm", "-q", "a.txt"]);
    fs::write(dir.path().join("b.txt"), "b\n").unwrap();

    let ws = Workspace::open(dir.path()).unwrap();
    let done = GitRepo::new(&ws).commit("delete a").unwrap();

    assert_eq!(done.files, 2);
    assert!(GitRepo::new(&ws).changes().unwrap().is_empty());
}

#[test]
fn branches_list() {
    let dir = repo();
    let ws = Workspace::open(dir.path()).unwrap();
    let info = GitRepo::new(&ws).branches();

    assert!(info.git);
    assert_eq!(info.current.as_deref(), Some("main"));
    assert_eq!(info.worktrees.len(), 1);
    assert!(info.worktrees[0].current);
}

#[test]
fn file_named_star_does_not_pull_in_other_files() {
    let dir = repo();

    fs::write(dir.path().join("*"), "star\n").unwrap();
    fs::write(dir.path().join("[a]"), "bracket\n").unwrap();
    fs::write(dir.path().join(":(top)x"), "magic\n").unwrap();
    fs::write(dir.path().join(".env"), "SECRET=1").unwrap();

    let ws = Workspace::open(dir.path()).unwrap();

    GitRepo::new(&ws).commit("literal names").unwrap();

    let shown = Command::new("git")
        .args(["show", "--name-only", "--format=", "HEAD"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    let names = String::from_utf8_lossy(&shown.stdout).into_owned();
    let names: Vec<&str> = names.lines().collect();

    assert!(names.contains(&"*"));
    assert!(names.contains(&"[a]"));
    // * `:(top)x` is hidden by the workspace path rules, so it is never staged.
    assert!(!names.contains(&":(top)x"), "{names:?}");
    assert!(!names.contains(&".env"), "{names:?}");
    assert!(dir.path().join(".env").is_file());
}

#[test]
fn oversized_head_blob_is_refused_before_loading() {
    let dir = repo();

    fs::write(
        dir.path().join("big.txt"),
        vec![b'a'; usize::try_from(workspace::MAX_READ_BYTES).unwrap() + 1],
    )
    .unwrap();
    git(dir.path(), &["add", "big.txt"]);
    git(dir.path(), &["commit", "-q", "-m", "big"]);

    let ws = Workspace::open(dir.path()).unwrap();

    assert_eq!(
        GitRepo::new(&ws).head_content("big.txt"),
        Err(WorkspaceError::TooLarge)
    );
}

#[test]
fn pull_fast_forwards_and_reports_the_git_error_otherwise() {
    let origin = repo();
    let clone = TempDir::new().unwrap();
    let target = clone.path().join("c");

    git(
        clone.path(),
        &["clone", "-q", origin.path().to_str().unwrap(), "c"],
    );
    fs::write(origin.path().join("n.txt"), "n\n").unwrap();
    git(origin.path(), &["add", "."]);
    git(origin.path(), &["commit", "-q", "-m", "second"]);

    let workspace = Workspace::open(&target).unwrap();

    assert!(GitRepo::new(&workspace).pull().is_ok());
    assert!(target.join("n.txt").exists());

    let lone = repo();
    let lone_workspace = Workspace::open(lone.path()).unwrap();
    let reason = GitRepo::new(&lone_workspace).pull().unwrap_err();

    assert!(reason.contains("tracking information") || reason.contains("upstream"));
}
