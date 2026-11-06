//! Shows or hides the three native window buttons (close, minimise, zoom) of the macOS title bar.

use tauri::{AppHandle, Manager, WebviewWindow};

/// Hides or shows the window buttons; a no-op outside macOS, where the title bar draws its own.
#[cfg(target_os = "macos")]
pub fn set_visible(window: &WebviewWindow, visible: bool) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let pointer = window.ns_window().map_err(|error| error.to_string())? as usize;

    // * AppKit views may only be touched on the main thread.
    window
        .run_on_main_thread(move || {
            // SAFETY: `pointer` is the live NSWindow of this webview window, and we are on the main thread.
            let ns_window = unsafe { &*(pointer as *const NSWindow) };

            for button in [
                NSWindowButton::CloseButton,
                NSWindowButton::MiniaturizeButton,
                NSWindowButton::ZoomButton,
            ] {
                if let Some(view) = ns_window.standardWindowButton(button) {
                    view.setHidden(!visible);
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn set_visible(_window: &WebviewWindow, _visible: bool) -> Result<(), String> {
    Ok(())
}

/// Hides the buttons of the first window; called once at start-up.
pub fn hide_at_startup(app: &AppHandle) {
    if let Some(window) = app.webview_windows().into_values().next() {
        let _ = set_visible(&window, false);
    }
}

#[tauri::command]
pub fn window_buttons_visible(window: WebviewWindow, visible: bool) -> Result<(), String> {
    set_visible(&window, visible)
}
