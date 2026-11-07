use super::*;
use tempfile::TempDir;

const MACHINE: Option<&str> = Some("darwin-arm64");

fn locator(home: &Path) -> Locator {
    Locator {
        home: home.to_path_buf(),
        platform: MACHINE,
        path_dirs: Vec::new(),
        fixed_dirs: Vec::new(),
        extensions: Default::default(),
    }
}

fn script(path: &Path, body: &str, executable: bool) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, body).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = if executable { 0o755 } else { 0o644 };

        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }
    #[cfg(not(unix))]
    let _ = executable;
}

/// An extension folder in the fake VS Code with a valid `package.json`.
fn extension(
    home: &Path,
    root: &str,
    id: &str,
    publisher: &str,
    name: &str,
    version: &str,
) -> PathBuf {
    let folder = home.join(root).join(format!("{id}-{version}"));

    fs::create_dir_all(&folder).unwrap();
    fs::write(
        folder.join("package.json"),
        format!(r#"{{"publisher":"{publisher}","name":"{name}"}}"#),
    )
    .unwrap();

    folder
}

fn rust_extension(home: &Path, root: &str, version: &str, executable: bool) -> PathBuf {
    let folder = extension(
        home,
        root,
        "rust-lang.rust-analyzer",
        "rust-lang",
        "rust-analyzer",
        version,
    );

    script(
        &folder.join("server/rust-analyzer"),
        "#!/bin/sh\n",
        executable,
    );

    folder
}

fn intelephense_extension(home: &Path) -> PathBuf {
    let folder = extension(
        home,
        ".vscode/extensions",
        "bmewburn.vscode-intelephense-client",
        "bmewburn",
        "vscode-intelephense-client",
        "1.18.5",
    );

    script(
        &folder.join("node_modules/intelephense/lib/intelephense.js"),
        "// server\n",
        false,
    );

    folder
}

fn fake_node(directory: &Path) -> PathBuf {
    let node = directory.join("node");

    script(&node, "#!/bin/sh\n", true);

    node
}

fn rust_spec() -> &'static ServerSpec {
    spec("rust-analyzer").unwrap()
}

#[test]
fn a_server_inside_a_vscode_extension_is_found_with_its_version_and_origin() {
    let home = TempDir::new().unwrap();

    rust_extension(home.path(), ".vscode/extensions", "0.3.3105", true);

    let found = candidates(rust_spec(), &locator(home.path()), false);

    assert_eq!(found.len(), 1);
    assert!(found[0].is_usable());
    assert_eq!(found[0].origin, CandidateOrigin::Vscode);
    assert_eq!(found[0].version.as_deref(), Some("0.3.3105"));
    assert_eq!(
        found[0].extension_id.as_deref(),
        Some("rust-lang.rust-analyzer")
    );

    let launch = found[0].launch.as_ref().unwrap();

    assert!(launch.program.ends_with("server/rust-analyzer"));
    assert!(launch.arguments.is_empty());
}

#[test]
fn each_editor_gets_its_own_candidate_and_auto_prefers_the_first() {
    let home = TempDir::new().unwrap();

    rust_extension(home.path(), ".cursor/extensions", "0.3.1", true);
    rust_extension(home.path(), ".vscode/extensions", "0.3.2", true);
    rust_extension(home.path(), ".vscode-oss/extensions", "0.3.3", true);

    let found = candidates(rust_spec(), &locator(home.path()), false);
    let origins: Vec<CandidateOrigin> = found.iter().map(|candidate| candidate.origin).collect();

    assert_eq!(
        origins,
        vec![
            CandidateOrigin::Vscode,
            CandidateOrigin::Cursor,
            CandidateOrigin::Vscodium
        ]
    );
    assert_eq!(select(&found, SourceChoice::Auto, None), Some(0));
    assert_eq!(
        select(&found, SourceChoice::Vscode, Some(ExtensionOrigin::Cursor)),
        Some(1)
    );
    assert_eq!(
        select(
            &found,
            SourceChoice::Vscode,
            Some(ExtensionOrigin::Insiders)
        ),
        None
    );
    assert_eq!(select(&found, SourceChoice::Path, None), None);
    assert_eq!(select(&found, SourceChoice::Download, None), None);
}

#[cfg(unix)]
#[test]
fn a_server_without_the_execute_bit_is_left_out_with_a_reason() {
    let home = TempDir::new().unwrap();

    rust_extension(home.path(), ".vscode/extensions", "0.3.1", false);

    let found = candidates(rust_spec(), &locator(home.path()), false);

    assert_eq!(found[0].problem, Some(PROBLEM_NOT_EXECUTABLE));
    assert!(found[0].launch.is_none());
    assert_eq!(select(&found, SourceChoice::Auto, None), None);
}

#[cfg(unix)]
#[test]
fn a_server_file_that_links_out_of_the_extension_is_left_out() {
    let home = TempDir::new().unwrap();
    let elsewhere = TempDir::new().unwrap();
    let folder = rust_extension(home.path(), ".vscode/extensions", "0.3.1", true);
    let outside = elsewhere.path().join("evil");

    script(&outside, "#!/bin/sh\n", true);
    fs::remove_file(folder.join("server/rust-analyzer")).unwrap();
    std::os::unix::fs::symlink(&outside, folder.join("server/rust-analyzer")).unwrap();

    let found = candidates(rust_spec(), &locator(home.path()), false);

    assert_eq!(found[0].problem, Some(PROBLEM_SYMLINK_OUTSIDE));
    assert!(found[0].launch.is_none());
}

#[test]
fn an_extension_without_the_server_file_is_left_out() {
    let home = TempDir::new().unwrap();

    extension(
        home.path(),
        ".vscode/extensions",
        "rust-lang.rust-analyzer",
        "rust-lang",
        "rust-analyzer",
        "0.3.1",
    );

    let found = candidates(rust_spec(), &locator(home.path()), false);

    assert_eq!(found[0].problem, Some(PROBLEM_EXTENSION_CHANGED));
}

#[test]
fn an_extension_folder_that_failed_the_scan_is_listed_with_its_reason() {
    let home = TempDir::new().unwrap();
    let folder = rust_extension(home.path(), ".vscode/extensions", "0.3.1", true);

    fs::write(folder.join("package.json"), "{ broken").unwrap();

    let found = candidates(rust_spec(), &locator(home.path()), false);

    assert_eq!(found.len(), 1);
    assert_eq!(
        found[0].problem,
        Some(vscode_extensions::PROBLEM_BAD_MANIFEST)
    );
}

#[test]
fn intelephense_runs_the_script_with_the_node_found_on_the_machine() {
    let home = TempDir::new().unwrap();
    let node_dir = TempDir::new().unwrap();
    let folder = intelephense_extension(home.path());
    let node = fake_node(node_dir.path());
    let mut place = locator(home.path());

    place.path_dirs = vec![node_dir.path().to_path_buf()];

    let found = candidates(spec("intelephense").unwrap(), &place, false);
    let launch = found[0].launch.as_ref().unwrap();

    assert_eq!(launch.program, node);
    assert_eq!(launch.arguments.len(), 2);
    assert!(Path::new(&launch.arguments[0]).starts_with(fs::canonicalize(&folder).unwrap()));
    assert!(launch.arguments[0].ends_with("node_modules/intelephense/lib/intelephense.js"));
    assert_eq!(launch.arguments[1], "--stdio");
    assert!(launch.extra_path.contains(&node_dir.path().to_path_buf()));
}

#[test]
fn intelephense_without_node_says_node_is_missing_and_does_not_run() {
    let home = TempDir::new().unwrap();

    intelephense_extension(home.path());

    let found = candidates(spec("intelephense").unwrap(), &locator(home.path()), false);

    assert_eq!(found[0].problem, Some(PROBLEM_NODE_MISSING));
    assert!(found[0].launch.is_none());
}

#[test]
fn node_is_searched_in_order_and_the_newest_nvm_version_is_taken_by_number() {
    let home = TempDir::new().unwrap();
    let place = locator(home.path());

    assert_eq!(place.node(), None);

    for version in ["v9.0.0", "v22.14.0", "v18.20.8", "not-a-version"] {
        fake_node(
            &home
                .path()
                .join(format!(".nvm/versions/node/{version}/bin")),
        );
    }

    assert_eq!(
        place.node().unwrap(),
        home.path().join(".nvm/versions/node/v22.14.0/bin/node")
    );

    let volta = fake_node(&home.path().join(".volta/bin"));

    assert_eq!(place.node().unwrap(), volta);

    let on_path = TempDir::new().unwrap();
    let mut with_path = place.clone();

    with_path.path_dirs = vec![on_path.path().to_path_buf()];
    fake_node(on_path.path());

    assert_eq!(with_path.node().unwrap(), on_path.path().join("node"));
}

#[test]
fn node_is_found_in_a_fnm_install_and_a_non_executable_node_is_ignored() {
    let home = TempDir::new().unwrap();
    let place = locator(home.path());

    script(&home.path().join(".volta/bin/node"), "", false);

    #[cfg(unix)]
    assert_eq!(place.node(), None);

    let fnm = fake_node(
        &home
            .path()
            .join(".local/share/fnm/node-versions/v20.1.0/installation/bin"),
    );

    assert_eq!(place.node().unwrap(), fnm);
}

#[test]
fn blade_templates_get_no_server_and_other_files_map_to_their_language() {
    assert!(spec_for_path("resources/views/home.blade.php").is_none());
    assert!(spec_for_path("HOME.BLADE.PHP").is_none());
    assert_eq!(
        spec_for_path("app/Models/User.php").map(|(spec, language)| (spec.id, language)),
        Some(("intelephense", "php"))
    );
    assert_eq!(
        spec_for_path("src/main.rs").map(|(spec, language)| (spec.id, language)),
        Some(("rust-analyzer", "rust"))
    );
    assert_eq!(
        spec_for_path("Program.CS").map(|(spec, language)| (spec.id, language)),
        Some(("csharp-ls", "csharp"))
    );
    assert!(spec_for_path("README.md").is_none());
    assert!(spec_for_path("Makefile").is_none());
    assert!(spec_for_path("folder.rs/file").is_none());
}

#[cfg(unix)]
#[test]
fn a_program_in_path_is_used_and_its_version_read() {
    let home = TempDir::new().unwrap();
    let bin = TempDir::new().unwrap();
    let mut place = locator(home.path());

    place.path_dirs = vec![bin.path().to_path_buf()];
    script(
        &bin.path().join("rust-analyzer"),
        "#!/bin/sh\necho 'rust-analyzer 1.85.0 (4d91de4e 2025-02-17)'\n",
        true,
    );

    let probed = candidates(rust_spec(), &place, true);
    let unprobed = candidates(rust_spec(), &place, false);

    assert_eq!(probed[0].origin, CandidateOrigin::Path);
    assert_eq!(probed[0].label, "rust-analyzer");
    assert_eq!(probed[0].version.as_deref(), Some("1.85.0"));
    assert!(probed[0].is_usable());
    assert_eq!(unprobed[0].version, None);
    assert!(unprobed[0].is_usable());
    assert_eq!(select(&probed, SourceChoice::Auto, None), Some(0));
    assert_eq!(select(&probed, SourceChoice::Path, None), Some(0));
    assert_eq!(select(&probed, SourceChoice::Vscode, None), None);
}

#[cfg(unix)]
#[test]
fn a_program_whose_version_check_fails_is_not_used() {
    let home = TempDir::new().unwrap();
    let bin = TempDir::new().unwrap();
    let mut place = locator(home.path());

    place.path_dirs = vec![bin.path().to_path_buf()];
    script(
        &bin.path().join("rust-analyzer"),
        "#!/bin/sh\necho \"error: unknown binary\" >&2\nexit 1\n",
        true,
    );

    let found = candidates(rust_spec(), &place, true);

    assert_eq!(found[0].problem, Some(PROBLEM_VERSION_CHECK_FAILED));
    assert_eq!(select(&found, SourceChoice::Auto, None), None);
}

#[cfg(unix)]
#[test]
fn an_extension_is_preferred_over_path_but_path_is_the_fallback() {
    let home = TempDir::new().unwrap();
    let bin = TempDir::new().unwrap();
    let mut place = locator(home.path());

    place.path_dirs = vec![bin.path().to_path_buf()];
    script(
        &bin.path().join("rust-analyzer"),
        "#!/bin/sh\necho 1.0.0\n",
        true,
    );

    assert_eq!(
        select(
            &candidates(rust_spec(), &place, false),
            SourceChoice::Auto,
            None
        ),
        Some(0)
    );

    rust_extension(home.path(), ".vscode/extensions", "0.3.1", true);

    // * The folders changed: a locator keeps what it read, so a new one looks again.
    let place = Locator {
        extensions: Default::default(),
        ..place
    };
    let found = candidates(rust_spec(), &place, false);

    assert_eq!(found.len(), 2);
    assert_eq!(
        found[select(&found, SourceChoice::Auto, None).unwrap()].origin,
        CandidateOrigin::Vscode
    );
    assert_eq!(
        found[select(&found, SourceChoice::Path, None).unwrap()].origin,
        CandidateOrigin::Path
    );
}

#[test]
fn only_whitelisted_program_names_are_ever_accepted_from_path() {
    let bin = TempDir::new().unwrap();
    let evil = bin.path().join("sh");

    script(&evil, "#!/bin/sh\n", true);

    for program in [
        evil.as_path(),
        Path::new("/bin/sh"),
        Path::new("/usr/bin/env"),
        Path::new(""),
    ] {
        assert_eq!(
            check_path_program(rust_spec(), program),
            Err(PROBLEM_NAME_REJECTED),
            "{program:?}"
        );
    }

    // * The name of another server is not accepted for this one either.
    let other = bin.path().join("csharp-ls");

    script(&other, "#!/bin/sh\n", true);

    assert_eq!(
        check_path_program(rust_spec(), &other),
        Err(PROBLEM_NAME_REJECTED)
    );
    assert!(check_path_program(spec("csharp-ls").unwrap(), &other).is_ok());
}

#[cfg(unix)]
#[test]
fn a_whitelisted_name_without_the_execute_bit_is_refused() {
    let bin = TempDir::new().unwrap();
    let program = bin.path().join("rust-analyzer");

    script(&program, "", false);

    assert_eq!(
        check_path_program(rust_spec(), &program),
        Err(PROBLEM_NOT_EXECUTABLE)
    );
}

#[cfg(unix)]
#[test]
fn csharp_ls_is_found_in_the_dotnet_tools_folder() {
    let home = TempDir::new().unwrap();
    let spec = spec("csharp-ls").unwrap();

    assert!(candidates(spec, &locator(home.path()), false).is_empty());

    script(
        &home.path().join(".dotnet/tools/csharp-ls"),
        "#!/bin/sh\necho 'csharp-ls, 0.15.0'\n",
        true,
    );

    let found = candidates(spec, &locator(home.path()), true);

    assert_eq!(found[0].origin, CandidateOrigin::Path);
    assert_eq!(found[0].version.as_deref(), Some("0.15.0"));
}

#[test]
fn other_programs_in_path_are_never_candidates() {
    let home = TempDir::new().unwrap();
    let bin = TempDir::new().unwrap();
    let mut place = locator(home.path());

    place.path_dirs = vec![bin.path().to_path_buf()];

    for name in ["sh", "node", "python", "rust-analyzer.sh"] {
        script(&bin.path().join(name), "#!/bin/sh\n", true);
    }

    for spec in &SERVERS {
        assert!(candidates(spec, &place, false).is_empty(), "{}", spec.id);
    }
}

#[test]
fn the_catalog_describes_every_server() {
    assert_eq!(SERVERS.len(), 3);
    assert_eq!(rust_spec().language_ids(), vec!["rust"]);
    assert_eq!(spec("nope").map(|spec| spec.id), None);

    let hint = install_hint(rust_spec());

    assert_eq!(hint.extension_id, Some("rust-lang.rust-analyzer"));
    assert_eq!(hint.display_name, "rust-analyzer");
    assert_eq!(install_hint(spec("csharp-ls").unwrap()).extension_id, None);
}

#[test]
fn only_intelephense_takes_initialization_options() {
    let storage = Path::new("/data/ls");

    assert_eq!(initialization_options(rust_spec(), storage), Value::Null);

    let options = initialization_options(spec("intelephense").unwrap(), storage);

    assert_eq!(options["storagePath"], "/data/ls/workspace");
    assert_eq!(options["globalStoragePath"], "/data/ls/global");
}

#[test]
fn choices_parse_from_the_names_the_front_end_sends() {
    for (text, choice) in [
        ("auto", SourceChoice::Auto),
        ("vscode", SourceChoice::Vscode),
        ("path", SourceChoice::Path),
        ("download", SourceChoice::Download),
    ] {
        assert_eq!(
            serde_json::from_str::<SourceChoice>(&format!("\"{text}\"")).unwrap(),
            choice
        );
    }

    assert!(serde_json::from_str::<SourceChoice>("\"custom\"").is_err());
}
