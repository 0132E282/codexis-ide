use super::*;
use crate::projects::EnvVar;
use std::fs;

fn state_with_projects(dir: &Path, folders: &[&Path]) -> (AppState, Vec<String>) {
    let state = AppState::new(
        ProjectStore::load(dir.join("rynox.db")),
        ChatStore::open(dir.join("rynox.db")),
    );
    let ids = folders
        .iter()
        .enumerate()
        .map(|(index, folder)| {
            state
                .add_project(NewProject {
                    name: format!("p{index}"),
                    folders: vec![folder.display().to_string()],
                    env: vec![EnvVar {
                        key: "A".into(),
                        value: "1".into(),
                    }],
                })
                .unwrap()
                .id
        })
        .collect();

    (state, ids)
}

#[test]
fn a_saved_project_keeps_its_name_and_id_and_an_unsaved_folder_gets_a_hash() {
    let data = tempfile::tempdir().unwrap();
    let saved = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let (state, ids) = state_with_projects(data.path(), &[saved.path()]);
    let saved_root = fs::canonicalize(saved.path()).unwrap();
    let (name, id) = state.project_identity(&saved_root);

    assert_eq!((name.as_str(), &id), ("p0", &ids[0]));

    let (name, id) = state.project_identity(other.path());

    assert_eq!(name, other.path().file_name().unwrap().to_string_lossy());
    assert_eq!(state.project_identity(other.path()).1, id);
}

#[test]
fn selecting_a_project_switches_the_root_and_keeps_the_sandbox() {
    let data = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();

    fs::write(first.path().join("a.txt"), "first").unwrap();
    fs::write(second.path().join("b.txt"), "second").unwrap();
    fs::write(second.path().join(".env"), "SECRET=1").unwrap();

    let (state, ids) = state_with_projects(data.path(), &[first.path(), second.path()]);

    state.select_project(&ids[0]).unwrap();
    assert_eq!(state.workspace().unwrap().read("a.txt").unwrap(), "first");

    let info = state.select_project(&ids[1]).unwrap();
    let workspace = state.workspace().unwrap();

    assert_eq!(
        workspace.root(),
        fs::canonicalize(second.path()).unwrap().as_path()
    );
    assert_eq!(
        info.name,
        second.path().file_name().unwrap().to_string_lossy()
    );
    assert_eq!(workspace.read("b.txt").unwrap(), "second");
    assert!(workspace.read("a.txt").is_err());
    assert_eq!(workspace.read("../a.txt"), Err(WorkspaceError::BadPath));
    assert_eq!(workspace.read(".env"), Err(WorkspaceError::Denied));
    assert_eq!(state.list_projects().selected, Some(ids[1].clone()));
}

#[test]
fn a_root_reaches_its_own_project_and_no_other_folder() {
    let data = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let stranger = tempfile::tempdir().unwrap();

    fs::write(first.path().join("a.txt"), "first").unwrap();
    fs::write(second.path().join("b.txt"), "second").unwrap();

    let (state, ids) = state_with_projects(data.path(), &[first.path(), second.path()]);
    let first_root = fs::canonicalize(first.path())
        .unwrap()
        .display()
        .to_string();
    let second_root = fs::canonicalize(second.path())
        .unwrap()
        .display()
        .to_string();

    state.select_project(&ids[1]).unwrap();

    // * The open workspace is the second project, yet the first one stays reachable by its root.
    let other = state.workspace_for(Some(&first_root)).unwrap();

    assert_eq!(other.read("a.txt").unwrap(), "first");
    assert_eq!(
        state
            .workspace_for(Some(&second_root))
            .unwrap()
            .read("b.txt")
            .unwrap(),
        "second"
    );
    assert_eq!(
        state.workspace_for(None).unwrap().read("b.txt").unwrap(),
        "second"
    );
    assert!(state
        .workspace_for(Some(&stranger.path().display().to_string()))
        .is_err());
}

#[test]
fn failed_selection_keeps_the_current_workspace() {
    let data = tempfile::tempdir().unwrap();
    let open = tempfile::tempdir().unwrap();
    let doomed = tempfile::tempdir().unwrap();
    let doomed_path = doomed.path().to_path_buf();
    let (state, ids) = state_with_projects(data.path(), &[open.path(), &doomed_path]);

    state.select_project(&ids[0]).unwrap();
    drop(doomed);

    assert!(state.select_project(&ids[1]).is_err());
    assert!(state.select_project("p99").is_err());
    assert_eq!(state.list_projects().selected, Some(ids[0].clone()));
    assert_eq!(
        state.workspace().unwrap().root(),
        fs::canonicalize(open.path()).unwrap().as_path()
    );
}

#[test]
fn project_without_folders_cannot_be_opened_and_removal_unselects() {
    let data = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let (state, ids) = state_with_projects(data.path(), &[folder.path()]);
    let empty = state
        .add_project(NewProject {
            name: "empty".into(),
            folders: vec![],
            env: vec![],
        })
        .unwrap();

    assert!(state.select_project(&empty.id).is_err());

    state.select_project(&ids[0]).unwrap();
    state.remove_project(&ids[0]).unwrap();

    assert_eq!(state.list_projects().selected, None);
    assert!(state.workspace().is_ok());
}
