//! Commands of the stored activity: file events, pictures of the chat, the index of plan files, and saving a plan into the project. Everything deleted here is a row of the app's database; no file of the project is ever removed.

use super::plan::project_data_dir;
use super::state::AppState;
use crate::activity::{
    self, ActivityStore, ChatImage, FileAction, FileEvent, FileEventFilter, ImageData,
    NewFileEvent, NewPlanRecord, Page, PlanRecord,
};
use crate::plans::docs::{self as plan_docs, PlanDoc};
use crate::plans::project::{self as plan_project, SavedPlan};
use crate::plans::store::PlanStore;
use crate::plans::types::StoredPlan;
use crate::settings::SettingsStore;
use crate::workspace::Workspace;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};

/// Event sent when a file event could not be stored: `{path, action, error}` (`error` is an `errors.*` key). The edit itself was done.
pub const FILE_EVENT_LOG_FAILED: &str = "file-event-log-failed";
/// Event sent when a plan was saved to the project on its own: `{root, path}`.
pub const PLAN_SAVED_TO_PROJECT: &str = "plan-saved-to-project";
/// Event sent when saving a plan to the project on its own failed: `{error}`.
pub const PLAN_SAVE_FAILED: &str = "plan-save-failed";
/// Event sent when a pasted picture could not be kept in the database: `{error}`. The attachment itself was saved.
pub const CHAT_IMAGE_STORE_FAILED: &str = "chat-image-store-failed";

/// Stores a file event after the operation it describes succeeded. A failure is reported to the front end as [`FILE_EVENT_LOG_FAILED`], never swallowed and never turned into a failure of the operation.
pub(super) fn log_file_event(app: &AppHandle, event: &NewFileEvent) {
    let report = |event: &NewFileEvent, key: &str| {
        let _ = app.emit(
            FILE_EVENT_LOG_FAILED,
            serde_json::json!({
                "path": event.path,
                "action": event.action.as_str(),
                "error": key,
            }),
        );
    };

    match app.try_state::<ActivityStore>() {
        Some(store) => activity::record_or_report(&store, event, report),
        None => report(event, "activity.save_failed"),
    }
}

/// Logs a save (or the first save of a new file) with the lines it added and removed, counted against `before`.
pub(super) fn log_save(
    app: &AppHandle,
    workspace: &Workspace,
    path: &str,
    before: Option<&str>,
    content: &str,
) {
    let (added, removed) = activity::line_change(before.unwrap_or(""), content);
    let action = if before.is_some() {
        FileAction::Save
    } else {
        FileAction::Create
    };

    log_file_event(
        app,
        &NewFileEvent {
            bytes_after: i64::try_from(content.len()).ok(),
            lines_added: Some(added),
            lines_removed: Some(removed),
            ..NewFileEvent::user(&workspace.root().display().to_string(), path, action)
        },
    );
}

/// The page size and start of a list; a missing value is the first 100.
fn page(limit: Option<u32>, offset: Option<u32>) -> (u32, u32) {
    (limit.unwrap_or(100), offset.unwrap_or(0))
}

#[tauri::command]
pub fn file_events_list(
    state: State<AppState>,
    activity: State<ActivityStore>,
    root: Option<String>,
    filters: Option<FileEventFilter>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Page<FileEvent>, String> {
    let root = state.workspace_key(root.as_deref())?;
    let (limit, offset) = page(limit, offset);

    activity
        .list_file_events(&root, &filters.unwrap_or_default(), limit, offset)
        .map_err(|error| error.to_string())
}

/// Deletes the file events with these ids; returns how many were deleted.
#[tauri::command]
pub fn file_events_delete(activity: State<ActivityStore>, ids: Vec<i64>) -> Result<usize, String> {
    activity
        .delete_file_events(&ids)
        .map_err(|error| error.to_string())
}

/// Deletes the file events of a project (only those before `before`, Unix seconds, when given); returns how many were deleted.
#[tauri::command]
pub fn file_events_clear(
    state: State<AppState>,
    activity: State<ActivityStore>,
    root: Option<String>,
    before: Option<i64>,
) -> Result<usize, String> {
    let root = state.workspace_key(root.as_deref())?;

    activity
        .clear_file_events(&root, before)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_images_list(
    state: State<AppState>,
    activity: State<ActivityStore>,
    root: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Page<ChatImage>, String> {
    let root = state.workspace_key(root.as_deref())?;
    let (limit, offset) = page(limit, offset);

    activity
        .list_images(&root, limit, offset)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_image_get(activity: State<ActivityStore>, id: i64) -> Result<ImageData, String> {
    activity.image(id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_images_delete(activity: State<ActivityStore>, ids: Vec<i64>) -> Result<usize, String> {
    activity
        .delete_images(&ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn plan_records_list(
    state: State<AppState>,
    activity: State<ActivityStore>,
    root: Option<String>,
) -> Result<Vec<PlanRecord>, String> {
    let root = state.workspace_key(root.as_deref())?;

    activity
        .list_plan_records(&root)
        .map_err(|error| error.to_string())
}

/// Deletes index rows of plans; the plan files stay in the project.
#[tauri::command]
pub fn plan_records_delete(activity: State<ActivityStore>, ids: Vec<i64>) -> Result<usize, String> {
    activity
        .delete_plan_records(&ids)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReply {
    pub upserted: usize,
    pub removed: usize,
    /// Plan files that could not be read; when there are any, no row is dropped.
    pub skipped: usize,
    pub truncated: bool,
}

fn record_of(plan: &PlanDoc) -> NewPlanRecord {
    let word = |value: serde_json::Value| value.as_str().unwrap_or_default().to_string();

    NewPlanRecord {
        path: plan.path.clone(),
        title: plan.title.clone(),
        status: word(serde_json::to_value(plan.status).unwrap_or_default()),
        tasks_total: i64::try_from(plan.tasks_total).unwrap_or(0),
        tasks_done: i64::try_from(plan.tasks_done).unwrap_or(0),
        format: word(serde_json::to_value(plan.format).unwrap_or_default()),
    }
}

/// Reads the plan files of the project (`docs/plans/`, read only) and makes the index match: new plans are added, known ones refreshed, and rows of files that are gone are dropped (only when every file could be read).
#[tauri::command]
pub async fn plan_records_sync(
    state: State<'_, AppState>,
    activity: State<'_, ActivityStore>,
    root: Option<String>,
) -> Result<SyncReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let key = workspace.root().display().to_string();
    let listed = super::blocking("plan_docs.list_failed", move || {
        Ok(plan_docs::list(&workspace))
    })
    .await?;
    let records: Vec<NewPlanRecord> = listed.plans.iter().map(record_of).collect();
    let prune = listed.skipped == 0 && !listed.truncated;
    let (upserted, removed) = activity
        .sync_plan_records(&key, &records, prune)
        .map_err(|error| error.to_string())?;

    Ok(SyncReply {
        upserted,
        removed,
        skipped: listed.skipped,
        truncated: listed.truncated,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPlanReply {
    /// Path relative to the project root.
    pub path: String,
    /// `md` or `json`.
    pub format: String,
    pub title: String,
    pub record_id: Option<i64>,
}

/// Writes the plan of `session` into the project and indexes it. Shared by the command and the automatic save.
fn save_session_plan(
    app: &AppHandle,
    workspace: &Workspace,
    name: &str,
    id: &str,
    session: &str,
    plans_dir: &str,
) -> Result<SavedPlanReply, String> {
    let stored = project_data_dir(app, name, id)
        .map(PlanStore::new)
        .and_then(|store| store.load(session))
        .and_then(|json| StoredPlan::from_json(&json))
        .ok_or_else(|| crate::plans::project::PlanSaveError::Empty.to_string())?;
    let saved: SavedPlan =
        plan_project::save(workspace, plans_dir, &stored, activity::now_seconds())
            .map_err(|error| error.to_string())?;
    let record_id = app.try_state::<ActivityStore>().and_then(|store| {
        store
            .upsert_plan_record(&workspace.root().display().to_string(), &saved.record())
            .ok()
    });

    Ok(SavedPlanReply {
        path: saved.path,
        format: saved.format.to_string(),
        title: saved.title,
        record_id,
    })
}

/// Saves the plan the AI wrote in `session` as a file of the project, on the person's request (even when the setting `savePlansToProject` is off). The folder is the setting `plansDir`; a file that exists is never overwritten (the name gets `-2`, `-3`...).
#[tauri::command]
pub fn plan_save_to_project(
    app: AppHandle,
    state: State<AppState>,
    settings: State<SettingsStore>,
    root: Option<String>,
    session: String,
) -> Result<SavedPlanReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let (name, id) = state.project_identity(workspace.root());
    let plans_dir = settings
        .get()
        .map_err(|error| error.to_string())?
        .effective_plans_dir();

    save_session_plan(&app, &workspace, &name, &id, &session, &plans_dir)
}

/// The automatic save of a plan the AI just wrote: only when the setting `savePlansToProject` is on. The front end learns the result through [`PLAN_SAVED_TO_PROJECT`] or [`PLAN_SAVE_FAILED`]; a failure never breaks the chat turn.
pub(super) fn auto_save_plan(app: &AppHandle, root: &Path, name: &str, id: &str, session: &str) {
    let Some(settings) = app
        .try_state::<SettingsStore>()
        .and_then(|store| store.get().ok())
        .filter(|settings| settings.save_plans_to_project)
    else {
        return;
    };
    let result = Workspace::open(root)
        .map_err(|error| error.to_string())
        .and_then(|workspace| {
            save_session_plan(
                app,
                &workspace,
                name,
                id,
                session,
                &settings.effective_plans_dir(),
            )
        });

    match result {
        Ok(saved) => {
            let _ = app.emit(
                PLAN_SAVED_TO_PROJECT,
                serde_json::json!({ "root": root.display().to_string(), "path": saved.path }),
            );
        }
        Err(error) => {
            let _ = app.emit(PLAN_SAVE_FAILED, serde_json::json!({ "error": error }));
        }
    }
}
