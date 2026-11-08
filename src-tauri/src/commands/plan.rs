use super::state::AppState;
use crate::plans::docs::{self as plan_docs, PlanDocDetail, PlanDocsList};
use crate::plans::store::PlanStore;
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

/// The plan documents of `docs/plans/` of the project at `root` (JSON preferred over Markdown), read only; an absent folder gives an empty list.
#[tauri::command]
pub async fn plan_docs_list(
    app: AppHandle,
    state: State<'_, AppState>,
    root: Option<String>,
) -> Result<PlanDocsList, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    // * Looking at the list also starts watching the folder, so the pane is told when a plan changes.
    plan_docs::watch(app, &workspace);

    super::blocking("plan_docs.list_failed", move || {
        Ok(plan_docs::list(&workspace))
    })
    .await
}

/// One plan of `docs/plans/` of the project at `root` in full (`path` is the `path` of a card), read only.
#[tauri::command]
pub async fn plan_doc_read(
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
) -> Result<PlanDocDetail, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("plan_docs.read_failed", move || {
        plan_docs::read(&workspace, &path).map_err(str::to_string)
    })
    .await
}

/// Sets the status of one plan of `docs/plans/` of the project at `root` (`path` is the `path` of a card; `status` is `draft`, `in_progress`, `review` or `done`): the status word of the file is rewritten, nothing else.
#[tauri::command]
pub async fn plan_doc_set_status(
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
    status: String,
) -> Result<(), String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("plan_docs.set_status_failed", move || {
        plan_docs::set_status(&workspace, &path, &status).map_err(str::to_string)
    })
    .await
}

/// Deletes a finished plan of `docs/plans/` of the project at `root` (`path` is the `path` of a card) with its evidence folder; a plan that is not `done` is refused.
#[tauri::command]
pub async fn plan_doc_delete(
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
) -> Result<(), String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("plan_docs.delete_failed", move || {
        plan_docs::delete(&workspace, &path).map_err(str::to_string)
    })
    .await
}
