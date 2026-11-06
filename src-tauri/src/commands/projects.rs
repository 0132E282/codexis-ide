use super::files::Info;
use super::state::AppState;
use crate::projects::{NewProject, Project};
use serde::Serialize;
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

#[tauri::command]
pub fn projects_remove(state: State<AppState>, id: String) -> Result<(), String> {
    state.remove_project(&id)
}

/// Switches the open workspace to the project's first folder; returns the new workspace's name.
#[tauri::command]
pub fn projects_select(state: State<AppState>, id: String) -> Result<Info, String> {
    state.select_project(&id)
}
