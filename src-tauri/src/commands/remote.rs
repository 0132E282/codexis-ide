use crate::remote::{self, Remote};
use tauri::{AppHandle, State};

/// Starts the server a phone connects to (or returns the running one): the address and pairing token for the QR code.
#[tauri::command]
pub fn remote_start(app: AppHandle, remote: State<Remote>) -> Result<remote::Info, String> {
    remote.start(&app)
}

/// Whether the phone server is running now (the rail's Remote Control switch).
#[tauri::command]
pub fn remote_status(remote: State<Remote>) -> bool {
    remote.is_running()
}

/// Stops the phone server: every phone is dropped and the token stops working.
#[tauri::command]
pub fn remote_stop(app: AppHandle, remote: State<Remote>) {
    remote.stop(&app);
}
