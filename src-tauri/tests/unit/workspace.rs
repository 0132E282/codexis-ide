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
        Err(WorkspaceError::BadPath)
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
    assert!(glob("*.key", "a.key") && glob("id_rsa*", "id_rsa.pub") && glob("a*b*c", "a--b--c"));
    assert!(!glob("*.key", "key") && !glob("secret*", "mysecret"));
}

#[test]
fn the_viewer_reads_inside_git_but_never_saves_there() {
    let (dir, workspace) = project();

    fs::create_dir(dir.path().join(".git")).unwrap();
    fs::write(dir.path().join(".git/note.txt"), "x").unwrap();

    assert_eq!(
        workspace.write_for_viewer(".git/note.txt", "y", None),
        Err(WorkspaceError::Denied)
    );
    assert_eq!(
        workspace.access(&Unguarded).current_hash(".git/note.txt"),
        Err(WorkspaceError::Denied)
    );
    assert_eq!(
        workspace.access(&Unguarded).read(".git/note.txt"),
        Ok("x".to_string())
    );
    assert_eq!(
        workspace.delete(".git/note.txt"),
        Err(WorkspaceError::Denied)
    );
}

#[test]
fn rename_refuses_closed_folders_on_either_side() {
    let (dir, workspace) = project();

    fs::create_dir_all(dir.path().join(".git/hooks")).unwrap();
    fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
    fs::write(dir.path().join(".git/hooks/a"), "x").unwrap();
    fs::write(dir.path().join("node_modules/pkg/i.js"), "x").unwrap();
    fs::write(dir.path().join("x"), "x").unwrap();
    fs::write(dir.path().join("a.txt"), "a").unwrap();

    for (path, name) in [
        (".git/hooks/a", "b"),
        ("node_modules/pkg/i.js", "j.js"),
        ("x", ".git"),
        ("x", "Node_Modules"),
        ("x", "vendor"),
    ] {
        assert_eq!(
            workspace.rename_for_viewer(path, name),
            Err(WorkspaceError::Denied),
            "{path} -> {name}"
        );
    }

    assert!(dir.path().join(".git/hooks/a").is_file());
    assert!(dir.path().join("x").is_file());
    assert_eq!(
        workspace.rename_for_viewer("a.txt", "b.txt"),
        Ok("b.txt".to_string())
    );
}

#[test]
fn rename_refuses_hidden_characters_and_device_names() {
    let (dir, workspace) = project();

    fs::write(dir.path().join("a.txt"), "a").unwrap();

    for name in ["a\u{202E}txt", "a\u{200B}b", "nul", "COM1.txt", "a.", "a:b"] {
        assert_eq!(
            workspace.rename_for_viewer("a.txt", name),
            Err(WorkspaceError::BadPath),
            "{name:?}"
        );
    }
}

#[test]
fn normalise_refuses_deceptive_segments_but_keeps_ordinary_ones() {
    for bad in [
        "a\u{202E}b.txt",
        "a/\u{200B}b",
        "\u{FEFF}a",
        "src/con",
        "src/NUL.txt",
        "lpt9",
        "a/b.",
        "a/b ",
        "a/b:stream",
    ] {
        assert_eq!(normalise(bad), None, "{bad:?}");
    }

    assert_eq!(normalise(&format!("a/{}", "x".repeat(256))), None);
    assert!(normalise(&format!("a/{}", "x".repeat(255))).is_some());

    for good in [
        "src/main.rs",
        ".github/ci.yml",
        "tài liệu/đọc.md",
        "console.log",
        "com10",
        "a b/c d.txt",
        "日本語/ファイル.txt",
    ] {
        assert_eq!(normalise(good).as_deref(), Some(good), "{good:?}");
    }
}
