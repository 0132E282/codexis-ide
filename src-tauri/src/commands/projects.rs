use super::files::Info;
use super::state::AppState;
use crate::language_server::LanguageServers;
use crate::projects::{NewProject, Project};
use crate::terminal::Terminals;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Serialize)]
pub struct ProjectsReply {
    pub(super) projects: Vec<Project>,
    /// Id of the saved project that is the open workspace.
    pub(super) selected: Option<String>,
}

#[tauri::command]
pub fn projects_list(state: State<AppState>) -> ProjectsReply {
    state.list_projects()
}

#[tauri::command]
pub fn projects_add(state: State<AppState>, project: NewProject) -> Result<Project, String> {
    state.add_project(project)
}

/// Removes a project from the list and stops the language servers started for it (in the background: they get a moment to shut down).
#[tauri::command]
pub fn projects_remove(
    state: State<AppState>,
    servers: State<LanguageServers>,
    id: String,
) -> Result<(), String> {
    let folder = state
        .list_projects()
        .projects
        .iter()
        .find(|project| project.id == id)
        .and_then(|project| project.folders.first().cloned());

    state.remove_project(&id)?;

    if let Some(folder) = folder {
        let servers = servers.inner().clone();
        let root = std::fs::canonicalize(&folder).unwrap_or_else(|_| PathBuf::from(&folder));

        std::thread::spawn(move || servers.stop_root(&root));
    }

    Ok(())
}

/// Switches the open workspace to the project's first folder; returns the new workspace's name.
#[tauri::command]
pub fn projects_select(state: State<AppState>, id: String) -> Result<Info, String> {
    state.select_project(&id)
}

/// Opens the code side of a project folder (files, editor, terminal) in a window of its own, a light page like the terminal window: standard window frame, no sidebar or sign-in check (async, so building the window cannot deadlock on Windows). `root` is a saved project or the open workspace; a window already open for it is only brought to the front.
#[tauri::command]
pub async fn project_code_window_open(
    app: AppHandle,
    state: State<'_, AppState>,
    terminals: State<'_, Terminals>,
    root: Option<String>,
) -> Result<String, String> {
    // * The folder is checked by the workspace sandbox (the open workspace or a saved project), so only a known folder gets a window.
    let folder = state.workspace_for(root.as_deref())?.root().to_path_buf();
    let name = folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let folder = folder.display().to_string();
    // * The label only holds hex digits of a hash of the folder, so the capability pattern `project-*` matches it and nothing unescaped gets in.
    let label = format!(
        "project-code-{}",
        &format!("{:x}", Sha256::digest(folder.as_bytes()))[..16]
    );

    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|error| error.to_string())?;

        return Ok(folder);
    }

    // * The terminal and the page of the window read the folder registered here.
    terminals
        .register_window(&label, &folder)
        .map_err(|error| error.to_string())?;

    let built = WebviewWindowBuilder::new(
        &app,
        label.clone(),
        WebviewUrl::App("index.html?view=code".into()),
    )
    .title(format!("Codexis \u{2014} {name}"))
    .inner_size(1100.0, 760.0)
    .min_inner_size(560.0, 360.0)
    .build();

    if let Err(error) = built {
        terminals.close_owned(&label);

        return Err(error.to_string());
    }

    Ok(folder)
}
