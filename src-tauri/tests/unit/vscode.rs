use super::*;

#[test]
fn folder_only() {
    assert_eq!(args(Path::new("/p"), None), ["--new-window", "/p"]);
}

#[test]
fn file_at_a_line_never_below_one() {
    assert_eq!(
        args(Path::new("/p"), Some((Path::new("/p/a.rs"), 12))),
        ["--new-window", "/p", "--goto", "/p/a.rs:12"],
    );
    assert_eq!(
        args(Path::new("/p"), Some((Path::new("/p/a.rs"), 0)))[3],
        "/p/a.rs:1"
    );
}

#[test]
fn a_denied_file_is_not_handed_over() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(".env"), "x").unwrap();
    let workspace = Workspace::open(dir.path()).unwrap();

    assert!(matches!(
        open(&workspace, Some(".env"), 1),
        Err(OpenError::Workspace(WorkspaceError::Denied))
    ));
    assert!(matches!(
        open(&workspace, Some("../x"), 1),
        Err(OpenError::Workspace(WorkspaceError::BadPath))
    ));
}
