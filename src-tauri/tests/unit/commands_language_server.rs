use super::*;
use crate::language_server_catalog::CandidateOrigin;
use std::path::PathBuf;
use tempfile::TempDir;

fn locator(home: &Path) -> Locator {
    Locator {
        home: home.to_path_buf(),
        platform: Some("darwin-arm64"),
        path_dirs: Vec::new(),
        fixed_dirs: Vec::new(),
    }
}

/// A fake VS Code with rust-analyzer 0.3.3105 and Intelephense installed.
fn home_with_extensions() -> TempDir {
    let home = TempDir::new().unwrap();
    let extensions = home.path().join(".vscode/extensions");
    let analyzer = extensions.join("rust-lang.rust-analyzer-0.3.3105-darwin-arm64");
    let intelephense = extensions.join("bmewburn.vscode-intelephense-client-1.18.5");

    for (folder, publisher, name, file) in [
        (
            &analyzer,
            "rust-lang",
            "rust-analyzer",
            "server/rust-analyzer",
        ),
        (
            &intelephense,
            "bmewburn",
            "vscode-intelephense-client",
            "node_modules/intelephense/lib/intelephense.js",
        ),
    ] {
        let path = folder.join(file);

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "#!/bin/sh\n").unwrap();
        fs::write(
            folder.join("package.json"),
            format!(r#"{{"publisher":"{publisher}","name":"{name}"}}"#),
        )
        .unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    home
}

fn setting(id: &str, enabled: bool, source: SourceChoice) -> ServerSetting {
    ServerSetting {
        id: id.to_string(),
        enabled,
        source,
        extension_root: None,
    }
}

#[test]
fn the_listing_shows_where_each_server_was_found_and_what_is_missing() {
    let home = home_with_extensions();
    let place = locator(home.path());
    let analyzer = listing(
        catalog::spec("rust-analyzer").unwrap(),
        &setting("rust-analyzer", false, SourceChoice::Auto),
        &place,
        None,
    );

    assert_eq!(analyzer.id, "rust-analyzer");
    assert_eq!(analyzer.languages, vec!["rust"]);
    assert!(!analyzer.enabled);
    assert_eq!(analyzer.candidates.len(), 1);
    assert_eq!(analyzer.candidates[0].origin, CandidateOrigin::Vscode);
    assert_eq!(analyzer.candidates[0].label, "rust-analyzer");
    assert_eq!(analyzer.candidates[0].version.as_deref(), Some("0.3.3105"));
    assert_eq!(analyzer.selected, Some(0));
    assert_eq!(analyzer.state, ServerState::Stopped);
    assert_eq!(analyzer.install_hint, None);
    assert!(!analyzer.can_download);

    // * Intelephense is there, but there is no Node to run it.
    let intelephense = listing(
        catalog::spec("intelephense").unwrap(),
        &setting("intelephense", true, SourceChoice::Auto),
        &place,
        None,
    );

    assert_eq!(
        intelephense.candidates[0].problem,
        Some("language_server.node_missing")
    );
    assert_eq!(intelephense.selected, None);
    assert_eq!(intelephense.state, ServerState::Missing);
    assert_eq!(
        intelephense
            .install_hint
            .as_ref()
            .and_then(|hint| hint.extension_id),
        Some("bmewburn.vscode-intelephense-client")
    );

    let csharp = listing(
        catalog::spec("csharp-ls").unwrap(),
        &setting("csharp-ls", false, SourceChoice::Auto),
        &place,
        None,
    );

    assert!(csharp.candidates.is_empty());
    assert_eq!(csharp.state, ServerState::Missing);
    assert_eq!(
        csharp.install_hint.as_ref().map(|hint| hint.display_name),
        Some("csharp-ls")
    );
}

#[test]
fn a_running_session_reports_its_own_state_and_last_error() {
    let home = home_with_extensions();
    let reply = listing(
        catalog::spec("rust-analyzer").unwrap(),
        &setting("rust-analyzer", true, SourceChoice::Auto),
        &locator(home.path()),
        Some((ServerState::Error, Some("language_server.crashed"))),
    );

    assert_eq!(reply.state, ServerState::Error);
    assert_eq!(reply.last_error, Some("language_server.crashed"));
}

#[test]
fn the_listing_serialises_with_camel_case_names() {
    let home = home_with_extensions();
    let reply = listing(
        catalog::spec("rust-analyzer").unwrap(),
        &setting("rust-analyzer", true, SourceChoice::Vscode),
        &locator(home.path()),
        None,
    );
    let json = serde_json::to_value(&reply).unwrap();

    for key in [
        "id",
        "name",
        "languages",
        "fileExtensions",
        "enabled",
        "source",
        "extensionRoot",
        "candidates",
        "selected",
        "state",
        "lastError",
        "installHint",
        "canDownload",
    ] {
        assert!(json.get(key).is_some(), "{key}");
    }

    assert_eq!(json["source"], "vscode");
    assert_eq!(json["fileExtensions"], serde_json::json!(["rs"]));
    assert_eq!(json["state"], "stopped");
    assert_eq!(json["candidates"][0]["origin"], "vscode");
    assert_eq!(
        json["candidates"][0]["extensionId"],
        "rust-lang.rust-analyzer"
    );
    assert!(json["candidates"][0].get("launch").is_none());
}

#[test]
fn the_launch_plan_follows_the_choice_and_skips_what_cannot_run() {
    let home = home_with_extensions();
    let place = locator(home.path());
    let storage = home.path().join("storage");
    let analyzer = catalog::spec("rust-analyzer").unwrap();
    let plan = launch_plan(
        analyzer,
        &setting("rust-analyzer", true, SourceChoice::Auto),
        &place,
        &storage,
    )
    .unwrap();

    assert!(plan.program.ends_with("server/rust-analyzer"));
    assert!(plan
        .program
        .starts_with(fs::canonicalize(home.path()).unwrap()));
    assert_eq!(plan.initialization_options, Value::Null);

    // * Another source was chosen and there is none of that kind.
    assert!(launch_plan(
        analyzer,
        &setting("rust-analyzer", true, SourceChoice::Path),
        &place,
        &storage
    )
    .is_none());
    assert!(launch_plan(
        analyzer,
        &setting("rust-analyzer", true, SourceChoice::Download),
        &place,
        &storage
    )
    .is_none());

    let mut wrong_root = setting("rust-analyzer", true, SourceChoice::Vscode);

    wrong_root.extension_root = Some("cursor".into());

    assert!(launch_plan(analyzer, &wrong_root, &place, &storage).is_none());

    // * No Node: Intelephense cannot be run; csharp-ls is not installed at all.
    assert!(launch_plan(
        catalog::spec("intelephense").unwrap(),
        &setting("intelephense", true, SourceChoice::Auto),
        &place,
        &storage
    )
    .is_none());
    assert!(launch_plan(
        catalog::spec("csharp-ls").unwrap(),
        &setting("csharp-ls", true, SourceChoice::Auto),
        &place,
        &storage
    )
    .is_none());
}

#[cfg(unix)]
#[test]
fn intelephense_gets_its_storage_folders_as_initialization_options() {
    use std::os::unix::fs::PermissionsExt;

    let home = home_with_extensions();
    let node = home.path().join(".volta/bin/node");

    fs::create_dir_all(node.parent().unwrap()).unwrap();
    fs::write(&node, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();

    let storage = PathBuf::from("/data/language-servers/intelephense/abc");
    let plan = launch_plan(
        catalog::spec("intelephense").unwrap(),
        &setting("intelephense", true, SourceChoice::Auto),
        &locator(home.path()),
        &storage,
    )
    .unwrap();

    assert_eq!(plan.program, node);
    assert_eq!(plan.arguments.last().map(String::as_str), Some("--stdio"));
    assert_eq!(
        plan.initialization_options["storagePath"],
        "/data/language-servers/intelephense/abc/workspace"
    );
}

#[test]
fn the_install_hint_is_an_extension_or_a_program_with_an_i18n_key() {
    let hint = catalog::install_hint(catalog::spec("rust-analyzer").unwrap());
    let json = serde_json::to_value(&hint).unwrap();

    assert_eq!(json["extensionId"], "rust-lang.rust-analyzer");
    assert_eq!(json["displayName"], "rust-analyzer");
    assert!(json["messageKey"]
        .as_str()
        .unwrap()
        .starts_with("language_server."));

    let program = catalog::install_hint(catalog::spec("csharp-ls").unwrap());

    assert_eq!(program.extension_id, None);
    assert_ne!(program.message_key, hint.message_key);
}

#[test]
fn the_file_edits_of_the_front_end_parse_with_monaco_ranges_and_a_null_hash() {
    let files: Vec<FileEdits> = serde_json::from_value(serde_json::json!([{
        "path": "a.rs",
        "expectedHash": null,
        "edits": [{
            "range": { "startLineNumber": 1, "startColumn": 1, "endLineNumber": 1, "endColumn": 2 },
            "text": "x"
        }]
    }]))
    .unwrap();

    assert_eq!(files[0].expected_hash, None);
    assert_eq!(files[0].edits[0].range.to_lsp().unwrap().end.character, 1);
}
