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

/// Separator of the folders a window holds in the one text that names them (the registry, the closing event); a folder name cannot contain a line break in practice.
pub const WINDOW_FOLDER_SEPARATOR: char = '\n';

/// The label of the code window of `folders`. It only holds hex digits of a hash of the folders, so the capability pattern `project-*` matches it and nothing unescaped gets in; one folder gives the same label as before groups existed.
pub fn code_window_label(folders: &[String]) -> String {
    let joined = folders.join(&WINDOW_FOLDER_SEPARATOR.to_string());

    format!(
        "project-code-{}",
        &format!("{:x}", Sha256::digest(joined.as_bytes()))[..16]
    )
}

/// Opens the code side of a project folder (files, editor, terminal) in a window of its own, a light page like the terminal window: standard window frame, no sidebar or sign-in check (async, so building the window cannot deadlock on Windows). `root` is a saved project or the open workspace; `roots` (two or more) puts every one of those projects in the same window, as the chats of a group are. A window already open for the same folders is only brought to the front. Answers with the folders, joined by [`WINDOW_FOLDER_SEPARATOR`], as the closing event reports them.
#[tauri::command]
pub async fn project_code_window_open(
    app: AppHandle,
    state: State<'_, AppState>,
    terminals: State<'_, Terminals>,
    root: Option<String>,
    roots: Option<Vec<String>>,
) -> Result<String, String> {
    // * Each folder is checked by the workspace sandbox (the open workspace or a saved project), so only a known folder gets a window.
    let requested = match roots {
        Some(roots) if roots.len() > 1 => roots.into_iter().map(Some).collect(),
        _ => vec![root],
    };
    let mut folders: Vec<String> = Vec::new();

    for requested_root in &requested {
        let folder = state
            .workspace_for(requested_root.as_deref())?
            .root()
            .display()
            .to_string();

        if !folders.contains(&folder) {
            folders.push(folder);
        }
    }

    let name = folders
        .iter()
        .map(|folder| {
            PathBuf::from(folder)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(", ");
    let folder = folders.join(&WINDOW_FOLDER_SEPARATOR.to_string());
    let label = code_window_label(&folders);

    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|error| error.to_string())?;

        return Ok(folder);
    }

    // * The terminal and the page of the window read the folders registered here.
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

#[cfg(test)]
#[path = "../../tests/unit/commands_projects.rs"]
mod tests;
