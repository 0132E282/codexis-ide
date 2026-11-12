//! The native menu bar: the menus Tauri makes by default, a short File menu (New Chat, New Project…, Open Folder…, Close Window), and a Terminal menu (new and split terminal) before Window. The Terminal items only tell the window, through the `menu-terminal` event; the terminals themselves live in the bottom panel. New Chat starts a conversation and New Project… / Open Folder… add a project (the window shows the folder picker); both only tell the window, through the `menu-file` event.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

/// Event sent to the window when a Terminal menu item is chosen; its payload is `new` or `split`.
pub const TERMINAL_EVENT: &str = "menu-terminal";

/// Event sent to the window when a File menu item is chosen; its payload is `open-folder` or `new-chat`.
pub const FILE_EVENT: &str = "menu-file";

const NEW_CHAT: &str = "file-new-chat";
const NEW_PROJECT: &str = "file-new-project";
const OPEN_FOLDER: &str = "file-open-folder";
const NEW_TERMINAL: &str = "terminal-new";
const SPLIT_TERMINAL: &str = "terminal-split";

/// A menu item that has no feature yet: shown, but greyed out.
fn unavailable(
    handle: &AppHandle,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(handle, id, text, false, accelerator)
}

/// The File menu, laid out like a chat app's: New Chat, the two ways to add a project, and Close Window.
fn file_menu(handle: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let separator = || PredefinedMenuItem::separator(handle);

    Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &MenuItem::with_id(handle, NEW_CHAT, "New Chat", true, Some("CmdOrCtrl+N"))?,
            &separator()?,
            &MenuItem::with_id(handle, NEW_PROJECT, "New Project…", true, None::<&str>)?,
            &MenuItem::with_id(
                handle,
                OPEN_FOLDER,
                "Open Folder…",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &separator()?,
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

/// Passes a File or Terminal menu choice on to the window; any other item is left to Tauri.
pub fn handle_event(app: &AppHandle, event: &MenuEvent) {
    let (name, action) = match event.id().as_ref() {
        NEW_CHAT => (FILE_EVENT, "new-chat"),
        NEW_PROJECT | OPEN_FOLDER => (FILE_EVENT, "open-folder"),
        NEW_TERMINAL => (TERMINAL_EVENT, "new"),
        SPLIT_TERMINAL => (TERMINAL_EVENT, "split"),
        _ => return,
    };

    let _ = app.emit(name, action);
}
