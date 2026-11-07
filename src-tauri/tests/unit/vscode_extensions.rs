use super::*;
use tempfile::TempDir;

const RUST_ANALYZER: &str = "rust-lang.rust-analyzer";
const MACHINE: Option<&str> = Some("darwin-arm64");

/// Makes `<home>/<root>/<folder>` with a valid `package.json` for `RUST_ANALYZER`.
fn install(home: &Path, root: &str, folder: &str) -> PathBuf {
    let directory = home.join(root).join(folder);

    fs::create_dir_all(&directory).unwrap();
    fs::write(
        directory.join("package.json"),
        r#"{"publisher":"rust-lang","name":"rust-analyzer","displayName":"rust-analyzer"}"#,
    )
    .unwrap();

    directory
}

fn versions(found: &[InstalledExtension]) -> Vec<(&str, Option<&'static str>)> {
    found
        .iter()
        .map(|extension| (extension.version.as_str(), extension.problem))
        .collect()
}

fn usable(found: &[InstalledExtension]) -> Vec<&InstalledExtension> {
    found
        .iter()
        .filter(|extension| extension.problem.is_none())
        .collect()
}

#[test]
fn finds_the_extension_in_every_whitelisted_root() {
    let home = TempDir::new().unwrap();

    for origin in ExtensionOrigin::ALL {
        install(
            home.path(),
            origin.extensions_folder(),
            "rust-lang.rust-analyzer-0.3.3105",
        );
    }

    let found = find(home.path(), RUST_ANALYZER, MACHINE);

    assert_eq!(
        found
            .iter()
            .map(|extension| extension.origin)
            .collect::<Vec<_>>(),
        vec![
            ExtensionOrigin::Vscode,
            ExtensionOrigin::Insiders,
            ExtensionOrigin::Cursor,
            ExtensionOrigin::Vscodium
        ]
    );
    assert!(found.iter().all(|extension| extension.problem.is_none()));
    assert_eq!(found[0].display_name, "rust-analyzer");
    assert!(found[0].folder.is_absolute());
}

#[test]
fn nothing_is_read_outside_the_four_roots() {
    let home = TempDir::new().unwrap();

    install(
        home.path(),
        ".vscode/other",
        "rust-lang.rust-analyzer-0.3.3105",
    );
    install(
        home.path(),
        "extensions",
        "rust-lang.rust-analyzer-0.3.3105",
    );
    install(
        home.path(),
        ".config/Code/extensions",
        "rust-lang.rust-analyzer-0.3.3105",
    );

    assert!(find(home.path(), RUST_ANALYZER, MACHINE).is_empty());
    assert!(find(&home.path().join("missing"), RUST_ANALYZER, MACHINE).is_empty());
    assert_eq!(
        ExtensionOrigin::parse("cursor"),
        Some(ExtensionOrigin::Cursor)
    );

    for name in ["/tmp", ".vscode/extensions", "VSCODE", "", "vscode/../x"] {
        assert_eq!(ExtensionOrigin::parse(name), None, "{name:?}");
    }
}

#[test]
fn the_newest_semver_wins_not_the_newest_text() {
    let home = TempDir::new().unwrap();

    for version in ["0.3.9", "0.3.10", "0.3.2", "0.3.10-pre.1"] {
        install(
            home.path(),
            ".vscode/extensions",
            &format!("rust-lang.rust-analyzer-{version}"),
        );
    }

    let found = find(home.path(), RUST_ANALYZER, MACHINE);

    assert_eq!(usable(&found)[0].version, "0.3.10");
    assert_eq!(usable(&found).len(), 1);
}

#[test]
fn a_folder_listed_in_obsolete_is_skipped() {
    let home = TempDir::new().unwrap();

    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.9",
    );
    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.10",
    );
    fs::write(
        home.path().join(".vscode/extensions/.obsolete"),
        r#"{"rust-lang.rust-analyzer-0.3.10":true,"other.thing-1.0.0":true}"#,
    )
    .unwrap();

    let found = find(home.path(), RUST_ANALYZER, MACHINE);

    assert_eq!(
        versions(&found),
        vec![("0.3.9", None), ("0.3.10", Some(PROBLEM_OBSOLETE))]
    );
}

#[test]
fn builds_for_another_platform_are_skipped() {
    let home = TempDir::new().unwrap();

    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.20-linux-x64",
    );
    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.10-darwin-arm64",
    );
    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.5",
    );

    assert_eq!(
        versions(&find(home.path(), RUST_ANALYZER, MACHINE)),
        vec![
            ("0.3.10", None),
            ("0.3.20", Some(PROBLEM_PLATFORM_MISMATCH)),
        ]
    );
    // * Without a known platform only a build for every platform is usable.
    assert_eq!(
        versions(&find(home.path(), RUST_ANALYZER, None)),
        vec![
            ("0.3.5", None),
            ("0.3.20", Some(PROBLEM_PLATFORM_MISMATCH)),
            ("0.3.10", Some(PROBLEM_PLATFORM_MISMATCH)),
        ]
    );
}

#[test]
fn extensions_json_decides_which_version_is_installed_and_a_broken_one_is_ignored() {
    let home = TempDir::new().unwrap();
    let root = home.path().join(".vscode/extensions");

    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.9",
    );
    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.10",
    );
    fs::write(
        root.join("extensions.json"),
        r#"[{"identifier":{"id":"Rust-Lang.Rust-Analyzer"},"version":"0.3.9","relativeLocation":"rust-lang.rust-analyzer-0.3.9"},{"identifier":{"id":"other.thing"},"relativeLocation":"other.thing-1.0.0"}]"#,
    )
    .unwrap();

    assert_eq!(
        versions(&find(home.path(), RUST_ANALYZER, MACHINE)),
        vec![("0.3.9", None), ("0.3.10", Some(PROBLEM_OBSOLETE))]
    );

    fs::write(root.join("extensions.json"), "{not json").unwrap();

    assert_eq!(
        versions(&find(home.path(), RUST_ANALYZER, MACHINE)),
        vec![("0.3.10", None)]
    );
}

#[cfg(unix)]
#[test]
fn a_folder_that_links_out_of_its_root_is_left_out_with_a_reason() {
    let home = TempDir::new().unwrap();
    let elsewhere = TempDir::new().unwrap();
    let target = install(elsewhere.path(), "x", "rust-lang.rust-analyzer-9.9.9");

    fs::create_dir_all(home.path().join(".vscode/extensions")).unwrap();
    std::os::unix::fs::symlink(
        &target,
        home.path()
            .join(".vscode/extensions/rust-lang.rust-analyzer-9.9.9"),
    )
    .unwrap();
    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.1",
    );

    let found = find(home.path(), RUST_ANALYZER, MACHINE);

    assert!(usable(&found)
        .iter()
        .all(|extension| extension.version == "0.3.1"));
    assert!(versions(&found).contains(&("9.9.9", Some(PROBLEM_SYMLINK_OUTSIDE))));
}

#[cfg(unix)]
#[test]
fn a_package_json_that_links_elsewhere_is_not_read() {
    let home = TempDir::new().unwrap();
    let elsewhere = TempDir::new().unwrap();
    let folder = install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.1",
    );

    fs::write(
        elsewhere.path().join("package.json"),
        r#"{"publisher":"rust-lang","name":"rust-analyzer"}"#,
    )
    .unwrap();
    fs::remove_file(folder.join("package.json")).unwrap();
    std::os::unix::fs::symlink(
        elsewhere.path().join("package.json"),
        folder.join("package.json"),
    )
    .unwrap();

    assert_eq!(
        versions(&find(home.path(), RUST_ANALYZER, MACHINE)),
        vec![("0.3.1", Some(PROBLEM_BAD_MANIFEST))]
    );
}

#[test]
fn a_manifest_that_is_too_big_broken_missing_or_for_another_extension_is_left_out() {
    let home = TempDir::new().unwrap();
    let write = |version: &str, manifest: Option<String>| {
        let folder = install(
            home.path(),
            ".vscode/extensions",
            &format!("rust-lang.rust-analyzer-{version}"),
        );

        match manifest {
            Some(text) => fs::write(folder.join("package.json"), text).unwrap(),
            None => fs::remove_file(folder.join("package.json")).unwrap(),
        }
    };

    write(
        "1.0.0",
        Some(format!(
            r#"{{"publisher":"rust-lang","name":"rust-analyzer","padding":"{}"}}"#,
            "x".repeat(2 * 1024 * 1024)
        )),
    );
    write("1.0.1", Some("{ broken".into()));
    write("1.0.2", None);
    write(
        "1.0.3",
        Some(r#"{"publisher":"evil","name":"rust-analyzer"}"#.into()),
    );
    write("1.0.4", Some(r#"{"name":"rust-analyzer"}"#.into()));

    let found = find(home.path(), RUST_ANALYZER, MACHINE);

    assert!(usable(&found).is_empty());
    assert_eq!(found.len(), 5);
    assert!(found
        .iter()
        .all(|extension| extension.problem == Some(PROBLEM_BAD_MANIFEST)));
}

#[test]
fn a_bad_newest_version_does_not_hide_an_older_good_one() {
    let home = TempDir::new().unwrap();

    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.1",
    );

    let bad = install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.2",
    );

    fs::write(bad.join("package.json"), "nope").unwrap();

    assert_eq!(
        versions(&find(home.path(), RUST_ANALYZER, MACHINE)),
        vec![("0.3.1", None), ("0.3.2", Some(PROBLEM_BAD_MANIFEST))]
    );
}

#[test]
fn a_translation_placeholder_is_not_used_as_the_display_name() {
    let home = TempDir::new().unwrap();
    let folder = install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-0.3.1",
    );

    fs::write(
        folder.join("package.json"),
        r#"{"publisher":"rust-lang","name":"rust-analyzer","displayName":"%displayName%"}"#,
    )
    .unwrap();

    assert_eq!(
        find(home.path(), RUST_ANALYZER, MACHINE)[0].display_name,
        "rust-analyzer"
    );
}

#[test]
fn other_extensions_and_look_alike_names_are_not_matched() {
    let home = TempDir::new().unwrap();

    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-nightly-0.3.1",
    );
    install(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer-evil-1.0.0",
    );
    install(home.path(), ".vscode/extensions", "rust-lang.rust-analyzer");
    install(
        home.path(),
        ".vscode/extensions",
        "xrust-lang.rust-analyzer-0.3.1",
    );

    assert!(find(home.path(), RUST_ANALYZER, MACHINE).is_empty());
}

#[test]
fn versions_parse_and_order_like_semver() {
    let parse = |text: &str| Version::parse(text).unwrap();

    assert!(parse("0.3.10") > parse("0.3.9"));
    assert!(parse("1.0.0") > parse("0.99.99"));
    assert!(parse("1.0.0") > parse("1.0.0-pre.1"));
    assert!(parse("1.0.0-pre.10") > parse("1.0.0-pre.2"));
    assert!(parse("1.0.0-pre.1") > parse("1.0.0-pre"));
    assert!(parse("1.0.0-beta") > parse("1.0.0-1"));
    assert_eq!(parse("v22.14.0"), parse("22.14.0+build.5"));

    for bad in [
        "1.2", "a.b.c", "1.2.3.4", "1.2.3-", "", "1..3", "-1.2.3", "1.2.3 ",
    ] {
        assert!(Version::parse(bad).is_none(), "{bad:?}");
    }
}

#[test]
fn one_scan_serves_several_extensions_without_reading_the_files_again() {
    let home = TempDir::new().unwrap();
    let root = ".vscode/extensions";

    install(home.path(), root, "rust-lang.rust-analyzer-0.3.3105");
    install(home.path(), root, "rust-lang.rust-analyzer-0.3.3000");
    fs::write(
        home.path().join(root).join(".obsolete"),
        r#"{"rust-lang.rust-analyzer-0.3.3000":true}"#,
    )
    .unwrap();
    fs::write(
        home.path().join(root).join("extensions.json"),
        r#"[{"identifier":{"id":"Rust-Lang.Rust-Analyzer"},"relativeLocation":"rust-lang.rust-analyzer-0.3.3105"}]"#,
    )
    .unwrap();

    let scan = ExtensionScan::default();
    let first = find_in(&scan, home.path(), RUST_ANALYZER, MACHINE);

    // * Everything on disk is gone: a second lookup in the same scan must be answered from memory.
    fs::remove_file(home.path().join(root).join(".obsolete")).unwrap();
    fs::remove_file(home.path().join(root).join("extensions.json")).unwrap();

    let again = find_in(&scan, home.path(), RUST_ANALYZER, MACHINE);
    let other = find_in(&scan, home.path(), "other.extension", MACHINE);

    assert_eq!(
        versions(&first),
        vec![("0.3.3105", None), ("0.3.3000", Some(PROBLEM_OBSOLETE)),]
    );
    assert_eq!(first, again);
    assert!(other.is_empty());
    // * A new scan sees the change.
    assert_eq!(
        usable(&find_in(
            &ExtensionScan::default(),
            home.path(),
            RUST_ANALYZER,
            MACHINE
        ))
        .len(),
        1
    );
}
