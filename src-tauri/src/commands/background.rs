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
            // * A finished task is not kept: the ones saved by an older version go too.
            table.clear_finished();
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
                project.table.clear_finished();

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
            project.table.clear_finished();
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
#[path = "../../tests/unit/commands_background.rs"]
mod tests;
