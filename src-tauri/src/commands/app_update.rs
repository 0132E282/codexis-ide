use crate::app_update::{self, AvailableUpdate, UpdateState};
use tauri::{AppHandle, State};

/// The newer version found by the last check, if any (the window may open after the `update-available` event).
#[tauri::command]
pub fn update_pending(state: State<UpdateState>) -> Option<AvailableUpdate> {
    app_update::pending(&state)
}

/// Downloads and installs the pending update (progress arrives as `update-progress`), then restarts the app.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    app_update::install(&app).await
}
