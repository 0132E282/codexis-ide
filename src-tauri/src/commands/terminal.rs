use super::state::AppState;
use crate::terminal::Terminals;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Label of the separate window that holds the bottom panel (the capability file matches `terminal-*`).
pub const WINDOW_LABEL: &str = "terminal-panel";

/// Opens a shell in the project folder; the panel reads it through the `terminal-data` event.
#[tauri::command]
pub fn terminal_open(
    window: WebviewWindow,
    state: State<AppState>,
    terminals: State<Terminals>,
    id: String,
    root: Option<String>,
    columns: u16,
    rows: u16,
) -> Result<(), String> {
    let workspace = state.workspace_for(root.as_deref())?;

    terminals
        .open(
            window.app_handle().clone(),
            id,
            window.label().to_string(),
            workspace.root(),
            columns,
            rows,
        )
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

/// Tabs of the bottom panel a separate window can open on.
const WINDOW_TABS: [&str; 5] = ["background", "terminal", "history", "plans", "data"];

/// Opens (async, so building the window cannot deadlock on Windows) the separate operating-system window that holds the whole bottom panel, on `tab`, for the project folder; its shells end when it is closed. A window that is already open is only brought to the front.
#[tauri::command]
pub async fn terminal_window_open(
    app: AppHandle,
    state: State<'_, AppState>,
    terminals: State<'_, Terminals>,
    root: Option<String>,
    tab: Option<String>,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        return existing.set_focus().map_err(|error| error.to_string());
    }

    let tab = tab.unwrap_or_else(|| "terminal".to_string());

    if !WINDOW_TABS.contains(&tab.as_str()) {
        return Err(format!("unknown bottom panel tab: {tab}"));
    }

    let folder = state
        .workspace_for(root.as_deref())?
        .root()
        .display()
        .to_string();

    terminals
        .register_window(WINDOW_LABEL, &folder)
        .map_err(|error| error.to_string())?;

    let built = WebviewWindowBuilder::new(
        &app,
        WINDOW_LABEL,
        WebviewUrl::App(format!("index.html?terminal&tab={tab}").into()),
    )
    .title("Codexis")
    .inner_size(980.0, 640.0)
    .min_inner_size(360.0, 240.0)
    .build();

    if let Err(error) = built {
        terminals.close_owned(WINDOW_LABEL);

        return Err(error.to_string());
    }

    Ok(())
}

/// The project folder the separate terminal window that asks was opened for.
#[tauri::command]
pub fn terminal_window_root(
    window: WebviewWindow,
    terminals: State<Terminals>,
) -> Result<Option<String>, String> {
    terminals
        .window_root(window.label())
        .map_err(|error| error.to_string())
}
