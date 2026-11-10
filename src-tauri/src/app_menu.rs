//! The native menu bar: the menus Tauri makes by default, a File menu laid out like VS Code's, and a Terminal menu (new and split terminal) before Window. The Terminal items only tell the window, through the `menu-terminal` event; the terminals themselves live in the bottom panel. Open… and Open Folder… add a project (the window shows the folder picker); the other File items have no feature yet and are greyed out.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

/// Event sent to the window when a Terminal menu item is chosen; its payload is `new` or `split`.
pub const TERMINAL_EVENT: &str = "menu-terminal";

/// Event sent to the window when a File menu item is chosen; its payload is `open-folder`.
pub const FILE_EVENT: &str = "menu-file";

const OPEN_FOLDER: &str = "file-open-folder";
const OPEN: &str = "file-open";
const NEW_TERMINAL: &str = "terminal-new";
const SPLIT_TERMINAL: &str = "terminal-split";

/// A File menu item that has no feature yet: shown, but greyed out.
fn unavailable(
    handle: &AppHandle,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(handle, id, text, false, accelerator)
}

/// The File menu in the order of VS Code's.
fn file_menu(handle: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let new_window_with_profile = Submenu::with_id(
        handle,
        "file-new-window-profile",
        "New Window with Profile",
        false,
    )?;
    let open_recent = Submenu::with_id(handle, "file-open-recent", "Open Recent", false)?;
    let share = Submenu::with_id(handle, "file-share", "Share", false)?;
    let separator = || PredefinedMenuItem::separator(handle);

    Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &unavailable(
                handle,
                "file-new-text-file",
                "New Text File",
                Some("CmdOrCtrl+N"),
            )?,
            &unavailable(
                handle,
                "file-new-file",
                "New File…",
                Some("Ctrl+Alt+CmdOrCtrl+N"),
            )?,
            &unavailable(
                handle,
                "file-new-window",
                "New Window",
                Some("Shift+CmdOrCtrl+N"),
            )?,
            &new_window_with_profile,
            &separator()?,
            &MenuItem::with_id(handle, OPEN, "Open…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(handle, OPEN_FOLDER, "Open Folder…", true, None::<&str>)?,
            &unavailable(
                handle,
                "file-open-workspace",
                "Open Workspace from File…",
                None,
            )?,
            &open_recent,
            &separator()?,
            &unavailable(handle, "file-add-folder", "Add Folder to Workspace…", None)?,
            &unavailable(handle, "file-save-workspace-as", "Save Workspace As…", None)?,
            &unavailable(
                handle,
                "file-duplicate-workspace",
                "Duplicate Workspace",
                None,
            )?,
            &separator()?,
            &unavailable(handle, "file-save", "Save", Some("CmdOrCtrl+S"))?,
            &unavailable(
                handle,
                "file-save-as",
                "Save As…",
                Some("Shift+CmdOrCtrl+S"),
            )?,
            &unavailable(handle, "file-save-all", "Save All", Some("Alt+CmdOrCtrl+S"))?,
            &separator()?,
            &share,
            &separator()?,
            &unavailable(handle, "file-auto-save", "Auto Save", None)?,
            &separator()?,
            &unavailable(handle, "file-revert", "Revert File", None)?,
            &unavailable(handle, "file-close-editor", "Close Editor", None)?,
            &unavailable(handle, "file-close-folder", "Close Folder", None)?,
            &PredefinedMenuItem::close_window(handle, Some("Close Window"))?,
        ],
    )
}

/// The Edit menu in the order of VS Code's: the system items (undo, clipboard, select all) work, the search and comment items have no feature yet and are greyed out. macOS adds AutoFill, Dictation and Emoji & Symbols by itself.
fn edit_menu(handle: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let separator = || PredefinedMenuItem::separator(handle);

    Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &separator()?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
            &separator()?,
            &unavailable(handle, "edit-find", "Find", Some("CmdOrCtrl+F"))?,
            &unavailable(handle, "edit-replace", "Replace", Some("Alt+CmdOrCtrl+F"))?,
            &separator()?,
            &unavailable(
                handle,
                "edit-find-in-files",
                "Find in Files",
                Some("Shift+CmdOrCtrl+F"),
            )?,
            &unavailable(
                handle,
                "edit-replace-in-files",
                "Replace in Files",
                Some("Shift+CmdOrCtrl+H"),
            )?,
            &separator()?,
            &unavailable(
                handle,
                "edit-toggle-line-comment",
                "Toggle Line Comment",
                Some("CmdOrCtrl+/"),
            )?,
            &unavailable(
                handle,
                "edit-toggle-block-comment",
                "Toggle Block Comment",
                Some("Alt+Shift+A"),
            )?,
        ],
    )
}

/// The default menu bar with the File and Edit menus replaced and the Terminal menu added.
///
/// # Errors
/// Fails when a menu or item cannot be created.
pub fn build(handle: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(handle)?;
    let terminal = Submenu::with_items(
        handle,
        "Terminal",
        true,
        &[
            &MenuItem::with_id(
                handle,
                NEW_TERMINAL,
                "New Terminal",
                true,
                Some("Ctrl+Shift+`"),
            )?,
            &MenuItem::with_id(
                handle,
                SPLIT_TERMINAL,
                "Split Terminal",
                true,
                Some("CmdOrCtrl+\\"),
            )?,
        ],
    )?;
    let submenu_position = |menu: &Menu<Wry>, title: &str| {
        menu.items().ok().and_then(|items| {
            items.iter().position(|item| {
                item.as_submenu()
                    .and_then(|submenu| submenu.text().ok())
                    .is_some_and(|text| text == title)
            })
        })
    };

    if let Some(position) = submenu_position(&menu, "File") {
        menu.remove(&menu.items()?[position])?;
        menu.insert(&file_menu(handle)?, position)?;
    }

    if let Some(position) = submenu_position(&menu, "Edit") {
        menu.remove(&menu.items()?[position])?;
        menu.insert(&edit_menu(handle)?, position)?;
    }

    let items = menu.items()?;
    let before_window = items
        .iter()
        .position(|item| {
            item.as_submenu()
                .and_then(|submenu| submenu.text().ok())
                .is_some_and(|text| text == "Window")
        })
        .unwrap_or(items.len());

    menu.insert(&terminal, before_window)?;

    Ok(menu)
}

/// Passes a Terminal menu choice on to the window; any other item is left to Tauri.
pub fn handle_event(app: &AppHandle, event: &MenuEvent) {
    let (name, action) = match event.id().as_ref() {
        OPEN | OPEN_FOLDER => (FILE_EVENT, "open-folder"),
        NEW_TERMINAL => (TERMINAL_EVENT, "new"),
        SPLIT_TERMINAL => (TERMINAL_EVENT, "split"),
        _ => return,
    };

    let _ = app.emit(name, action);
}
