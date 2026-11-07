use super::state::AppState;
use crate::plan_store::PlanStore;
use crate::project_data::ProjectData;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// The folder in the app's data where the data of the project (`name`, `id`) is kept, created when missing; none when it cannot be made, so a failure never breaks a turn.
pub(super) fn project_data_dir(app: &AppHandle, name: &str, id: &str) -> Option<PathBuf> {
    let data_dir = app.path().app_data_dir().ok()?;

    ProjectData::dir(&data_dir, name, id).ok()
}

/// The plan the AI wrote in `session` of the project at `root`, as JSON `{"todos", "markdown"}`; none when there is none. `root` must be the open project or a saved one.
#[tauri::command]
pub fn plan_load(
    app: AppHandle,
    state: State<AppState>,
    root: Option<String>,
    session: String,
) -> Result<Option<String>, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let (name, id) = state.project_identity(workspace.root());

    Ok(project_data_dir(&app, &name, &id)
        .map(PlanStore::new)
        .and_then(|store| store.load(&session)))
}
