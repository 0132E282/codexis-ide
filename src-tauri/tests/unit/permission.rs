use super::*;
use tempfile::TempDir;

#[test]
fn guarded_refuses_secrets_and_unguarded_lets_them_through() {
    for relative in [".env", ".git/config", "node_modules/a.js", "keys/id.pem"] {
        assert!(Guarded.refuses(relative), "{relative}");
        assert!(!Unguarded.refuses(relative), "{relative}");
    }

    assert!(!Guarded.refuses("src/main.rs"));
}

#[test]
fn open_needs_an_existing_directory() {
    let dir = TempDir::new().unwrap();
    let file = dir.path().join("a.txt");
    fs::write(&file, "x").unwrap();

    assert!(Sandbox::open(dir.path()).is_some());
    assert!(Sandbox::open(&file).is_none());
    assert!(Sandbox::open(&dir.path().join("missing")).is_none());
}

#[test]
fn resolve_accepts_paths_inside_and_refuses_outside_or_missing() {
    let dir = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let sandbox = Sandbox::open(dir.path()).unwrap();
    fs::create_dir(dir.path().join("src")).unwrap();
    fs::write(dir.path().join("src/a.txt"), "x").unwrap();
    fs::write(outside.path().join("b.txt"), "x").unwrap();

    let inside = sandbox.resolve(&dir.path().join("src/a.txt")).unwrap();

    assert!(sandbox.contains(&inside));
    assert_eq!(sandbox.relative(&inside), "src/a.txt");
    assert!(sandbox.resolve(&outside.path().join("b.txt")).is_none());
    assert!(sandbox.resolve(&dir.path().join("../escape")).is_none());
    assert!(sandbox.resolve(&dir.path().join("nope.txt")).is_none());
    assert_eq!(sandbox.relative(outside.path()), "");
}

#[cfg(unix)]
#[test]
fn a_link_leaving_the_folder_is_refused() {
    let dir = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("secret.txt"), "x").unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
    let sandbox = Sandbox::open(dir.path()).unwrap();

    assert!(sandbox
        .resolve(&dir.path().join("link/secret.txt"))
        .is_none());
}
