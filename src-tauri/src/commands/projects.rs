use super::files::Info;
use super::state::AppState;
use crate::language_server::LanguageServers;
use crate::projects::{NewProject, Project};
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

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
