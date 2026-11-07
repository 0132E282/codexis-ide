use super::*;
use std::path::Path;
use tempfile::TempDir;

fn store() -> (TempDir, ProjectStore) {
    let dir = tempfile::tempdir().unwrap();
    let store: ProjectStore = ProjectStore::load(dir.path().join("data").join("rynox.db"));

    (dir, store)
}

fn new_project(name: &str, folders: &[&Path]) -> NewProject {
    NewProject {
        name: name.to_string(),
        folders: folders
            .iter()
            .map(|folder| folder.display().to_string())
            .collect(),
        env: vec![EnvVar {
            key: "API_TOKEN".into(),
            value: "s3cret".into(),
        }],
    }
}

#[test]
fn added_project_survives_a_reload() {
    let (dir, mut store) = store();
    let folder = dir.path().join("app");

    fs::create_dir(&folder).unwrap();

    let added = store.add(new_project("  Ứng dụng  ", &[&folder])).unwrap();
    store.select(&added.id).unwrap();

    let reloaded = ProjectStore::load(store.path.clone());

    assert_eq!(reloaded.projects(), std::slice::from_ref(&added));
    assert_eq!(reloaded.selected(), Some(added.id.as_str()));
    assert_eq!(added.name, "Ứng dụng");
    assert_eq!(
        added.folders,
        [fs::canonicalize(&folder).unwrap().display().to_string()]
    );
}

#[test]
fn adding_the_same_folders_returns_the_existing_project() {
    let (dir, mut store) = store();
    let folder = dir.path().join("app");

    fs::create_dir(&folder).unwrap();

    let first = store.add(new_project("app", &[&folder])).unwrap();
    let again = store.add(new_project("other name", &[&folder])).unwrap();

    assert_eq!(again, first);
    assert_eq!(store.projects().len(), 1);
}

#[test]
fn ids_are_not_reused_while_a_later_project_exists() {
    let (_dir, mut store) = store();
    let first = store.add(new_project("a", &[])).unwrap();
    let second = store.add(new_project("b", &[])).unwrap();

    store.remove(&first.id).unwrap();

    let third = store.add(new_project("c", &[])).unwrap();

    assert_ne!(third.id, second.id);
}

#[test]
fn bad_input_is_refused_and_nothing_is_saved() {
    let (dir, mut store) = store();
    let file = dir.path().join("file.txt");

    fs::write(&file, "x").unwrap();

    let refused = [
        (new_project("   ", &[]), ProjectError::InvalidName),
        (
            new_project("x", &[&dir.path().join("missing")]),
            ProjectError::InvalidFolder,
        ),
        (new_project("x", &[&file]), ProjectError::InvalidFolder),
    ];

    for (project, error) in refused {
        assert_eq!(store.add(project).unwrap_err(), error);
    }

    for key in ["", "1A", "A B", "A=B", "A\n"] {
        let mut project = new_project("x", &[]);

        project.env[0].key = key.into();

        assert_eq!(
            store.add(project).unwrap_err(),
            ProjectError::InvalidEnv,
            "key {key:?}"
        );
    }

    let mut duplicate = new_project("x", &[]);

    duplicate.env.push(duplicate.env[0].clone());

    assert_eq!(store.add(duplicate).unwrap_err(), ProjectError::InvalidEnv);
    assert!(store.projects().is_empty());
    assert!(ProjectStore::load(store.path.clone()).projects().is_empty());
}

#[test]
fn removing_the_selected_project_clears_the_selection() {
    let (_dir, mut store) = store();
    let project = store.add(new_project("a", &[])).unwrap();

    store.select(&project.id).unwrap();
    store.remove(&project.id).unwrap();

    assert_eq!(store.selected(), None);
    assert_eq!(store.remove(&project.id), Err(ProjectError::NotFound));
    assert_eq!(store.select("p99"), Err(ProjectError::NotFound));
}

#[test]
fn file_that_is_not_a_database_is_moved_aside_and_the_store_starts_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rynox.db");

    fs::write(
        &path,
        "this is not a database, just text that is long enough",
    )
    .unwrap();

    let store = ProjectStore::load(path.clone());

    assert!(store.projects().is_empty());
    assert!(dir.path().join("rynox.db.corrupt").exists());
}

#[test]
fn projects_of_an_old_json_file_are_copied_in_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rynox.db");
    let legacy = dir.path().join("projects.json");
    let json = r#"{"projects":[{"id":"p3","name":"Cũ","folders":[],"env":[]}],"selected":"p3"}"#;

    fs::write(&legacy, json).unwrap();

    let mut store = ProjectStore::load(path.clone());

    assert_eq!(store.projects().len(), 1);
    assert_eq!(store.selected(), Some("p3"));
    assert_eq!(fs::read_to_string(&legacy).unwrap(), json);

    // Deleted in the app: the old file must not bring it back at the next start.
    store.remove("p3").unwrap();

    assert!(ProjectStore::load(path).projects().is_empty());
}

#[test]
fn debug_output_never_shows_a_value() {
    let var = EnvVar {
        key: "API_TOKEN".into(),
        value: "s3cret".into(),
    };

    assert!(!format!("{var:?}").contains("s3cret"));
}

#[cfg(unix)]
#[test]
fn store_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let (_dir, mut store) = store();

    store.add(new_project("a", &[])).unwrap();

    let mode = fs::metadata(&store.path).unwrap().permissions().mode();

    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn sensitive_names_and_control_values_are_refused() {
    let (_dir, mut store) = store();

    for key in [
        "PATH",
        "path",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "NODE_OPTIONS",
        "CLAUDE_CONFIG_DIR",
        "GH_CONFIG_DIR",
        "CODEX_HOME",
        "ANTHROPIC_API_KEY",
    ] {
        let mut project = new_project("x", &[]);

        project.env[0].key = key.into();

        assert_eq!(
            store.add(project).unwrap_err(),
            ProjectError::InvalidEnv,
            "key {key}"
        );
    }

    for value in ["a\nb", "a\rb", "a\u{1b}[0m", "a\0b"] {
        let mut project = new_project("x", &[]);

        project.env[0].value = value.into();

        assert_eq!(
            store.add(project).unwrap_err(),
            ProjectError::InvalidEnv,
            "value {value:?}"
        );
    }

    let mut project = new_project("x", &[]);

    project.env[0].key = "PATHS".into();
    project.env[0].value = "a\tb".into();

    assert!(store.add(project).is_ok());
}
