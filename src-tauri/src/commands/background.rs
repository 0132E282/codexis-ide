//! Commands of the Background tasks pane: list, stop and clear the work the AI runs in the background, per project. The table of a project is kept in memory and its finished tasks in `projects/<key>/tasks.json` of the app data folder.

use super::agent::{kill, TurnRegistry};
use super::state::AppState;
use crate::background::{BackgroundTasks, Task, ERROR_STOP_FAILED, MAX_TASKS};
use crate::project_data::ProjectData;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

const TASKS_FILE: &str = "tasks.json";
/// Largest `tasks.json` that is read; a bigger file is ignored.
const MAX_TASKS_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct TasksFile {
    tasks: Vec<Task>,
}

/// The text of `path`, or nothing when it is missing, unreadable, not text or over [`MAX_TASKS_FILE_BYTES`].
fn read_limited(path: &Path) -> String {
    use std::io::Read;

    let Ok(file) = std::fs::File::open(path) else {
        return String::new();
    };
    let mut text = String::new();

    // * One byte more than the limit tells an oversize file from one that fits exactly.
    match file
        .take(MAX_TASKS_FILE_BYTES + 1)
        .read_to_string(&mut text)
    {
        Ok(read) if read as u64 <= MAX_TASKS_FILE_BYTES => text,
        _ => String::new(),
    }
}

/// The table of one project and where its finished tasks are saved.
pub struct ProjectTasks {
    pub table: BackgroundTasks,
    dir: PathBuf,
    /// The text last written, so an unchanged table is not written again.
    saved: Mutex<String>,
}

impl ProjectTasks {
    fn open(dir: PathBuf) -> Self {
        let table = BackgroundTasks::new();
        let saved = read_limited(&dir.join(TASKS_FILE));

        if let Ok(file) = serde_json::from_str::<TasksFile>(&saved) {
            table.restore(file.tasks);
        }

        Self {
            table,
            dir,
            saved: Mutex::new(saved),
        }
    }

    /// Writes the finished tasks (at most [`MAX_TASKS`]); running ones do not outlive the app. A failed write is reported and leaves the table as it is.
    pub fn save(&self) -> Result<(), String> {
        let finished: Vec<Task> = self
            .table
            .snapshot()
            .into_iter()
            .filter(|task| task.state != crate::background::TaskState::Running)
            .take(MAX_TASKS)
            .collect();
        let text = serde_json::to_string(&TasksFile { tasks: finished })
            .map_err(|_| "background.save_failed".to_string())?;
        let mut saved = self
            .saved
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if *saved == text {
            return Ok(());
        }

        ProjectData::write_atomic(&self.dir, Path::new(TASKS_FILE), text.as_bytes())
            .map_err(|_| "background.save_failed".to_string())?;
        *saved = text;

        Ok(())
    }
}

/// The background tables of the projects, and which turn is running for each, so a stop reaches the right CLI.
pub struct BackgroundStore {
    data_dir: PathBuf,
    projects: Mutex<HashMap<String, Arc<ProjectTasks>>>,
    live_runs: Mutex<HashMap<String, String>>,
}

impl BackgroundStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            projects: Mutex::default(),
            live_runs: Mutex::default(),
        }
    }

    /// The table of the project at `root`, loaded from its data folder on first use.
    ///
    /// # Errors
    /// `background.storage_failed` when the project's data folder cannot be made.
    pub fn project(&self, root: &str, name: &str, id: &str) -> Result<Arc<ProjectTasks>, String> {
        let mut projects = self
            .projects
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if let Some(found) = projects.get(root) {
            return Ok(found.clone());
        }

        let dir = ProjectData::dir(&self.data_dir, name, id)
            .map_err(|_| "background.storage_failed".to_string())?;
        let opened = Arc::new(ProjectTasks::open(dir));

        projects.insert(root.to_string(), opened.clone());

        Ok(opened)
    }

    /// Remembers the turn running for `root` (or forgets it with `None`).
    pub fn set_live_run(&self, root: &str, run_id: Option<&str>) {
        let mut runs = self
            .live_runs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        match run_id {
            Some(run_id) => runs.insert(root.to_string(), run_id.to_string()),
            None => runs.remove(root),
        };
    }

    /// The app is closing: the tasks still running die with their CLI, so they are marked Stopped and saved.
    pub fn stop_all(&self) {
        let projects = self
            .projects
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        for project in projects.values() {
            if project.table.stop_all_running() {
                if let Err(message) = project.save() {
                    eprintln!("background tasks not saved: {message}");
                }
            }
        }
    }

    fn live_run(&self, root: &str) -> Option<String> {
        self.live_runs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(root)
            .cloned()
    }
}

#[derive(Serialize)]
pub struct TaskList {
    tasks: Vec<Task>,
}

fn project_of(
    state: &AppState,
    store: &BackgroundStore,
    root: &str,
) -> Result<(String, Arc<ProjectTasks>), String> {
    let workspace = state.workspace_for(Some(root))?;
    let key = workspace.root().display().to_string();
    let (name, id) = state.project_identity(workspace.root());
    let project = store.project(&key, &name, &id)?;

    Ok((key, project))
}

/// The background tasks of the project at `root`.
#[tauri::command]
pub fn background_list(
    state: State<'_, AppState>,
    store: State<'_, BackgroundStore>,
    root: String,
) -> Result<TaskList, String> {
    let (_, project) = project_of(&state, &store, &root)?;

    Ok(TaskList {
        tasks: project.table.snapshot(),
    })
}

/// Asks the CLI to stop one running task. A shell command gets the CLI's own `stop_task` control request (no model call); it needs a running turn that keeps the CLI's input open (only "Hỏi từng việc"). The task becomes Stopped only when the CLI reports it. A sub-agent runs inside the CLI, so stopping it ends the whole turn.
///
/// # Errors
/// `background.not_found` for an unknown task, `background.stop_failed` when it is not running or no open turn can reach it.
#[tauri::command]
pub fn background_stop(
    state: State<'_, AppState>,
    store: State<'_, BackgroundStore>,
    registry: State<'_, TurnRegistry>,
    root: String,
    id: String,
) -> Result<(), String> {
    let (key, project) = project_of(&state, &store, &root)?;
    let handle = project.table.stop_target(&id)?;
    let run_id = store
        .live_run(&key)
        .ok_or_else(|| ERROR_STOP_FAILED.to_string())?;

    match handle {
        Some(handle) => registry
            .responder(&run_id)
            .and_then(|responder| responder.stop_task(&handle))
            .map_err(|_| ERROR_STOP_FAILED.to_string()),
        None => {
            kill(registry.pid(&run_id).map_err(|_| ERROR_STOP_FAILED)?)
                .map_err(|_| ERROR_STOP_FAILED.to_string())?;

            project.table.stop(&id)?;
            project.save()
        }
    }
}

/// Removes the tasks that are no longer running.
#[tauri::command]
pub fn background_clear(
    state: State<'_, AppState>,
    store: State<'_, BackgroundStore>,
    root: String,
) -> Result<(), String> {
    let (_, project) = project_of(&state, &store, &root)?;

    project.table.clear_finished();
    project.save()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::background::{TaskKind, TaskState, ERROR_NOT_FOUND};
    use tempfile::tempdir;

    #[test]
    fn finished_tasks_are_saved_and_loaded_and_running_ones_are_not() {
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

        let reopened = BackgroundStore::new(data.path().to_path_buf())
            .project("/p", "demo", "id1")
            .unwrap();
        let tasks = reopened.table.snapshot();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "a");
        assert_eq!(tasks[0].state, TaskState::Done);
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
}
