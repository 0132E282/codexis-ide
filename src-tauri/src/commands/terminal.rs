use super::state::AppState;
use crate::terminal::{TerminalSnapshot, Terminals};
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

/// What the shell printed lately and how many bytes it has printed in all (the `end` of a `terminal-data` event tells which chunks the snapshot already holds).
#[tauri::command]
pub fn terminal_snapshot(
    terminals: State<Terminals>,
    id: String,
) -> Result<TerminalSnapshot, String> {
    terminals.snapshot(&id).map_err(|error| error.to_string())
}

/// Tabs of the bottom panel a separate window can open on.
const WINDOW_TABS: [&str; 5] = ["background", "terminal", "history", "plans", "data"];

/// Opens (async, so building the window cannot deadlock on Windows) the separate operating-system window that holds the whole bottom panel, on `tab`, for the project folder; its shells end when it is closed. A window that is already open is only brought to the front.
#[tauri::command]
pub async fn terminal_window_open(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    terminals: State<'_, Terminals>,
    root: Option<String>,
    tab: Option<String>,
    sessions: Option<Vec<String>>,
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

    // * The shells of the panel move with it: the new window owns them (they keep running) and shows them again. Ids that are not open are left out.
    let previous_owner = window.label().to_string();
    let adopted = terminals
        .adopt(&sessions.unwrap_or_default(), WINDOW_LABEL)
        .map_err(|error| {
            terminals.close_owned(WINDOW_LABEL);

            error.to_string()
        })?;
    let mut address = format!("index.html?terminal&tab={tab}");

    // * Ids are letters, digits, `_` and `-` (checked by `adopt`), so they need no escaping in the address.
    if !adopted.is_empty() {
        address.push_str(&format!("&sessions={}", adopted.join(",")));
    }

    let built = WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::App(address.into()))
    .title("Codexis")
    .inner_size(980.0, 640.0)
    .min_inner_size(360.0, 240.0)
    .build();

    if let Err(error) = built {
        // * Back to the window that had them, so a failed window does not end the shells.
        let _ = terminals.adopt(&adopted, &previous_owner);
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
