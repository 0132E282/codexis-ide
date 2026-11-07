//! Commands of the storage report and the cleanup the person confirms. The report only reads; the cleanup removes the app's own rows and files of one kind and only with `confirm: true`.

use super::plan::project_data_dir;
use super::state::AppState;
use crate::activity::{self, ActivityStore};
use crate::db;
use crate::project_data::PROJECTS_DIR;
use crate::settings::SettingsStore;
use crate::storage::{self, Cleaned, CleanupKind, Sources, StorageError, StorageUsage, Thresholds};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// Everything the storage functions need to know about where the data is.
struct Locations {
    root: String,
    database: PathBuf,
    projects_dir: PathBuf,
    project_dir: Option<PathBuf>,
}

impl Locations {
    fn of(app: &AppHandle, state: &AppState, root: Option<&str>) -> Result<Self, String> {
        let workspace = state.workspace_for(root)?;
        let (name, id) = state.project_identity(workspace.root());
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| StorageError::ReadFailed.to_string())?;

        Ok(Self {
            root: workspace.root().display().to_string(),
            database: db::path(&data_dir),
            projects_dir: data_dir.join(PROJECTS_DIR),
            project_dir: project_data_dir(app, &name, &id),
        })
    }

    fn sources(&self) -> Sources<'_> {
        Sources {
            root: Some(&self.root),
            projects_dir: &self.projects_dir,
            project_dir: self.project_dir.as_deref(),
            database: &self.database,
        }
    }
}

/// How much room the data of the IDE takes: the project's (`items`, `warnings`) and the whole app's (`app`), with warnings by the limits (scaled by the setting `storageWarnMultiplier`, none when `storageWarnings` is off). Read only: nothing is deleted.
#[tauri::command]
pub fn storage_usage(
    app: AppHandle,
    state: State<AppState>,
    activity: State<ActivityStore>,
    settings: State<SettingsStore>,
    root: Option<String>,
) -> Result<StorageUsage, String> {
    let locations = Locations::of(&app, &state, root.as_deref())?;
    let settings = settings.get().map_err(|error| error.to_string())?;

    storage::usage(
        &activity,
        &locations.sources(),
        &Thresholds::standard(settings.effective_warn_multiplier()),
        settings.storage_warnings,
    )
    .map_err(|error| error.to_string())
}

/// Removes the data of one kind (`file_events`, `chat_images`, `plan_records`, `run_logs`, `session_plans`) of the project, only what is older than `olderThanDays` when given. Refused unless `confirm` is `true`. Only the app's own data goes; no file of the project does.
#[tauri::command]
pub fn storage_cleanup(
    app: AppHandle,
    state: State<AppState>,
    activity: State<ActivityStore>,
    root: Option<String>,
    kind: String,
    older_than_days: Option<u32>,
    confirm: Option<bool>,
) -> Result<Cleaned, String> {
    let kind = CleanupKind::parse(&kind).ok_or_else(|| StorageError::BadKind.to_string())?;
    let confirmed = confirm == Some(true);

    if !confirmed {
        return Err(StorageError::ConfirmRequired.to_string());
    }

    let locations = Locations::of(&app, &state, root.as_deref())?;

    storage::cleanup(
        &activity,
        kind,
        &locations.sources(),
        older_than_days,
        confirmed,
        activity::now_seconds(),
    )
    .map_err(|error| error.to_string())
}
