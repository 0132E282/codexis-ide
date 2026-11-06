use super::state::AppState;
use crate::terminal::Terminals;
use tauri::{AppHandle, State};

/// Opens a shell in the project folder; the panel reads it through the `terminal-data` event.
#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    state: State<AppState>,
    terminals: State<Terminals>,
    id: String,
    root: Option<String>,
    columns: u16,
    rows: u16,
) -> Result<(), String> {
    let workspace = state.workspace_for(root.as_deref())?;

    terminals
        .open(app, id, workspace.root(), columns, rows)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_write(terminals: State<Terminals>, id: String, data: String) -> Result<(), String> {
    terminals
        .write(&id, &data)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_resize(
    terminals: State<Terminals>,
    id: String,
    columns: u16,
    rows: u16,
) -> Result<(), String> {
    terminals
        .resize(&id, columns, rows)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_close(terminals: State<Terminals>, id: String) -> Result<(), String> {
    terminals.close(&id).map_err(|error| error.to_string())
}
