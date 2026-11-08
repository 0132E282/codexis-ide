use super::*;
use crate::background::{TaskKind, TaskState, ERROR_NOT_FOUND};
use tempfile::tempdir;

#[test]
fn finished_tasks_are_not_kept_and_old_saved_ones_are_dropped() {
    let data = tempdir().unwrap();
    let store = BackgroundStore::new(data.path().to_path_buf());
    let project = store.project("/p", "demo", "id1").unwrap();

    project.table.start("a", TaskKind::Shell, "done one");
    project.table.start("b", TaskKind::Shell, "running one");
    project.table.finish("a", TaskState::Done);
    project.save().unwrap();

    let file = data.path().join("projects/demo/tasks.json");
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.contains("done one") && !text.contains("running one"));

    // * The file of an older version still holds a finished task: opening the project drops it.
    let reopened = BackgroundStore::new(data.path().to_path_buf())
        .project("/p", "demo", "id1")
        .unwrap();
    assert!(reopened.table.snapshot().is_empty());
}

#[test]
fn an_oversize_tasks_file_is_ignored() {
    let data = tempdir().unwrap();
    let file = data.path().join(TASKS_FILE);

    std::fs::write(&file, " ".repeat(MAX_TASKS_FILE_BYTES as usize + 1)).unwrap();
    assert_eq!(read_limited(&file), "");

    std::fs::write(&file, r#"{"tasks":[]}"#).unwrap();
    assert_eq!(read_limited(&file), r#"{"tasks":[]}"#);
    assert_eq!(read_limited(&data.path().join("missing.json")), "");
}

#[test]
fn the_same_root_gives_the_same_table_and_clear_keeps_running() {
    let data = tempdir().unwrap();
    let store = BackgroundStore::new(data.path().to_path_buf());
    let first = store.project("/p", "demo", "id1").unwrap();
    let again = store.project("/p", "demo", "id1").unwrap();

    assert!(Arc::ptr_eq(&first, &again));

    first.table.start("run", TaskKind::Shell, "x");
    first.table.start("old", TaskKind::Shell, "y");
    first.table.finish("old", TaskState::Failed);
    first.table.clear_finished();
    first.save().unwrap();

    let tasks = first.table.snapshot();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, "run");
    assert_eq!(first.table.stop("zzz"), Err(ERROR_NOT_FOUND));
}

#[test]
fn a_live_run_is_remembered_per_root() {
    let store = BackgroundStore::new(PathBuf::new());

    assert_eq!(store.live_run("/p"), None);
    store.set_live_run("/p", Some("run1"));
    assert_eq!(store.live_run("/p").as_deref(), Some("run1"));
    store.set_live_run("/p", None);
    assert_eq!(store.live_run("/p"), None);
}
