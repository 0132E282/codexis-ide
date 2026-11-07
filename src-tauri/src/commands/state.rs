use super::files::Info;
use super::projects::ProjectsReply;
use crate::chats::ChatStore;
use crate::projects::{NewProject, Project, ProjectStore};
use crate::workspace::{Workspace, WorkspaceError};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard};

/// Environment variable naming the project folder to open (falls back to the current folder).
pub const WORKSPACE_ENV: &str = "RYNOX_WORKSPACE";

/// The open workspace and the saved project it came from (None for the start-up folder).
#[derive(Debug)]
struct Active {
    workspace: Result<Workspace, WorkspaceError>,
    project: Option<String>,
}

#[derive(Debug)]
pub struct AppState {
    active: RwLock<Active>,
    projects: Mutex<ProjectStore>,
    chats: Mutex<ChatStore>,
}

impl AppState {
    /// Start-up folder: `RYNOX_WORKSPACE`, else the project opened last time, else the current folder.
    pub fn new(projects: ProjectStore, chats: ChatStore) -> Self {
        let active = match std::env::var_os(WORKSPACE_ENV) {
            Some(root) => Active {
                workspace: Workspace::open(Path::new(&root)),
                project: None,
            },
            None => Self::last_opened(&projects).unwrap_or_else(|| Active {
                workspace: Workspace::open(&std::env::current_dir().unwrap_or_default()),
                project: None,
            }),
        };

        Self {
            active: RwLock::new(active),
            projects: Mutex::new(projects),
            chats: Mutex::new(chats),
        }
    }

    fn last_opened(projects: &ProjectStore) -> Option<Active> {
        let project = projects.get(projects.selected()?)?;
        let workspace = Workspace::open(Path::new(project.folders.first()?)).ok()?;

        Some(Active {
            workspace: Ok(workspace),
            project: Some(project.id.clone()),
        })
    }

    fn read_active(&self) -> RwLockReadGuard<'_, Active> {
        self.active.read().expect("workspace lock poisoned")
    }

    fn lock_projects(&self) -> MutexGuard<'_, ProjectStore> {
        self.projects.lock().expect("projects lock poisoned")
    }

    pub(super) fn lock_chats(&self) -> MutexGuard<'_, ChatStore> {
        self.chats.lock().expect("chats lock poisoned")
    }

    /// A copy of the open workspace (cheap: it only holds the root path), so no lock is held while a command runs.
    pub(super) fn workspace(&self) -> Result<Workspace, String> {
        self.read_active()
            .workspace
            .clone()
            .map_err(|error| error.to_string())
    }

    /// The workspace at `root`, so several projects can stay open at once: `None` is the open workspace. Any other root must be the open one or the first folder of a saved project, so a caller can never reach a folder the user did not add.
    pub(crate) fn workspace_for(&self, root: Option<&str>) -> Result<Workspace, String> {
        let active = self.workspace()?;
        let Some(root) = root else {
            return Ok(active);
        };

        if Path::new(root) == active.root() {
            return Ok(active);
        }

        let known = self
            .lock_projects()
            .projects()
            .iter()
            .any(|project| project.folders.first().is_some_and(|folder| folder == root));

        if !known {
            return Err(WorkspaceError::Denied.to_string());
        }

        Workspace::open(Path::new(root)).map_err(|error| error.to_string())
    }

    /// The root path of the workspace at `root`, the key chats are stored under.
    pub(super) fn workspace_key(&self, root: Option<&str>) -> Result<String, String> {
        Ok(self.workspace_for(root)?.root().display().to_string())
    }

    /// The name and id the data of the project at `root` is kept under: those of the saved project whose first folder is `root`; a folder that is no saved project gets its own folder name and a hash of the path.
    pub(super) fn project_identity(&self, root: &Path) -> (String, String) {
        let root_text = root.to_string_lossy();
        let saved = self
            .lock_projects()
            .projects()
            .iter()
            .find(|project| {
                project
                    .folders
                    .first()
                    .is_some_and(|folder| *folder == root_text)
            })
            .map(|project| (project.name.clone(), project.id.clone()));

        saved.unwrap_or_else(|| {
            let name = root
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let hash = format!("{:x}", Sha256::digest(root_text.as_bytes()));

            (name, hash[..12].to_string())
        })
    }

    pub(super) fn list_projects(&self) -> ProjectsReply {
        let projects = self.lock_projects();

        ProjectsReply {
            projects: projects.projects().to_vec(),
            selected: self.read_active().project.clone(),
        }
    }

    pub(super) fn add_project(&self, new: NewProject) -> Result<Project, String> {
        self.lock_projects()
            .add(new)
            .map_err(|error| error.to_string())
    }

    pub(super) fn remove_project(&self, id: &str) -> Result<(), String> {
        let mut projects = self.lock_projects();

        projects.remove(id).map_err(|error| error.to_string())?;

        // The open workspace stays as it is; it just no longer belongs to a saved project.
        let mut active = self.active.write().expect("workspace lock poisoned");

        if active.project.as_deref() == Some(id) {
            active.project = None;
        }

        Ok(())
    }

    /// Makes the project's first folder the workspace root. The new root goes through `Workspace::open` like any other, so every path rule of the sandbox applies to it.
    pub(super) fn select_project(&self, id: &str) -> Result<Info, String> {
        let mut projects = self.lock_projects();
        let folder = projects
            .get(id)
            .ok_or(crate::projects::ProjectError::NotFound)
            .and_then(|project| {
                project
                    .folders
                    .first()
                    .cloned()
                    .ok_or(crate::projects::ProjectError::NoFolder)
            })
            .map_err(|error| error.to_string())?;
        let workspace = Workspace::open(Path::new(&folder)).map_err(|error| error.to_string())?;

        projects.select(id).map_err(|error| error.to_string())?;

        let info = Info::of(&workspace);

        *self.active.write().expect("workspace lock poisoned") = Active {
            workspace: Ok(workspace),
            project: Some(id.to_string()),
        };

        Ok(info)
    }
}

#[cfg(test)]
#[path = "../../tests/unit/commands_state.rs"]
mod tests;
