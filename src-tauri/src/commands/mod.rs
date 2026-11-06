//! Tauri commands the front end reaches through `invoke()`, grouped by domain. Thin wrappers over the backend modules; errors are the fixed messages only.

pub mod agent;
pub mod attachments;
pub mod auth;
pub mod chat;
pub mod files;
pub mod git;
pub mod inline_ask;
pub mod projects;
pub mod remote;
mod state;
pub mod terminal;

pub use state::{AppState, WORKSPACE_ENV};

/// Runs blocking work (subprocesses, disk walks) on the blocking pool so the UI thread stays free; `failure` is the message when the task itself dies.
async fn blocking<T, F>(failure: &'static str, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| failure.to_string())?
}
