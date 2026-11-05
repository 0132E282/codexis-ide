//! Tauri commands the front end reaches through `invoke()`. Thin wrappers over `workspace` and `vscode`; errors are the fixed messages only.

use crate::agent::{self, Cli};
use crate::auth;
use crate::chats::{ChatHistory, ChatStore, ChatTurn, Conversation};
use crate::credentials::CredentialStore;
use crate::git::{self, Branches, Change, Committed};
use crate::profiles::{self, ProfileStore};
use crate::projects::{NewProject, Project, ProjectStore};
use crate::vscode;
use crate::workspace::{Workspace, WorkspaceError};
use serde::Serialize;
use std::path::Path;
use std::sync::{Mutex, RwLock};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

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

    /// A copy of the open workspace (cheap: it only holds the root path), so no lock is held while a command runs.
    fn workspace(&self) -> Result<Workspace, String> {
        self.active
            .read()
            .expect("workspace lock poisoned")
            .workspace
            .clone()
            .map_err(|error| error.to_string())
    }

    /// The workspace at `root`, so several projects can stay open at once: `None` is the open workspace. Any other root must be the open one or the first folder of a saved project, so a caller can never reach a folder the user did not add.
    fn workspace_for(&self, root: Option<&str>) -> Result<Workspace, String> {
        let active = self.workspace()?;
        let Some(root) = root else {
            return Ok(active);
        };

        if Path::new(root) == active.root() {
            return Ok(active);
        }

        let known = self
            .projects
            .lock()
            .expect("projects lock poisoned")
            .projects()
            .iter()
            .any(|project| project.folders.first().is_some_and(|folder| folder == root));

        if !known {
            return Err(crate::workspace::WorkspaceError::Denied.to_string());
        }

        Workspace::open(Path::new(root)).map_err(|error| error.to_string())
    }

    fn list_projects(&self) -> ProjectsReply {
        let projects = self.projects.lock().expect("projects lock poisoned");

        ProjectsReply {
            projects: projects.projects().to_vec(),
            selected: self
                .active
                .read()
                .expect("workspace lock poisoned")
                .project
                .clone(),
        }
    }

    fn add_project(&self, new: NewProject) -> Result<Project, String> {
        self.projects
            .lock()
            .expect("projects lock poisoned")
            .add(new)
            .map_err(|error| error.to_string())
    }

    fn remove_project(&self, id: &str) -> Result<(), String> {
        let mut projects = self.projects.lock().expect("projects lock poisoned");

        projects.remove(id).map_err(|error| error.to_string())?;

        // The open workspace stays as it is; it just no longer belongs to a saved project.
        let mut active = self.active.write().expect("workspace lock poisoned");

        if active.project.as_deref() == Some(id) {
            active.project = None;
        }

        Ok(())
    }

    /// Makes the project's first folder the workspace root. The new root goes through `Workspace::open` like any other, so every path rule of the sandbox applies to it.
    fn select_project(&self, id: &str) -> Result<Info, String> {
        let mut projects = self.projects.lock().expect("projects lock poisoned");
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

#[derive(Debug, Serialize)]
pub struct Info {
    name: String,
    /// Full path of the workspace root: the key the front end hands back (`root`) to address this project.
    root: String,
}

impl Info {
    fn of(workspace: &Workspace) -> Self {
        let root = workspace.root();
        let name = root.file_name().map_or_else(
            || root.display().to_string(),
            |n| n.to_string_lossy().into_owned(),
        );

        Self {
            name,
            root: root.display().to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ProjectsReply {
    projects: Vec<Project>,
    /// Id of the saved project that is the open workspace.
    selected: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TreeReply {
    paths: Vec<String>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct FileReply {
    content: String,
    hash: String,
}

#[tauri::command]
pub fn workspace_info(state: State<AppState>) -> Result<Info, String> {
    Ok(Info::of(&state.workspace()?))
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

#[tauri::command]
pub fn workspace_tree(state: State<AppState>, root: Option<String>) -> Result<TreeReply, String> {
    let tree = state.workspace_for(root.as_deref())?.tree();

    Ok(TreeReply {
        paths: tree.paths,
        truncated: tree.truncated,
    })
}

#[tauri::command]
pub fn workspace_read(
    state: State<AppState>,
    root: Option<String>,
    path: String,
) -> Result<FileReply, String> {
    let content = state
        .workspace_for(root.as_deref())?
        .read(&path)
        .map_err(|error| error.to_string())?;
    let hash = crate::workspace::hash(&content);

    Ok(FileReply { content, hash })
}

/// Raw bytes of a picture or PDF, sent to the front end as a binary reply (no text encoding in between).
#[tauri::command]
pub fn workspace_read_media(
    state: State<AppState>,
    root: Option<String>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    state
        .workspace_for(root.as_deref())?
        .read_bytes(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

/// Saves a file; `expected_hash` is the hash read earlier, a mismatch is a conflict. Returns the new hash.
#[tauri::command]
pub fn workspace_write(
    state: State<AppState>,
    root: Option<String>,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<String, String> {
    state
        .workspace_for(root.as_deref())?
        .write(&path, &content, expected_hash.as_deref())
        .map(|written| written.after)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_in_vscode(
    state: State<AppState>,
    root: Option<String>,
    path: Option<String>,
    line: Option<u32>,
) -> Result<(), String> {
    vscode::open(
        &state.workspace_for(root.as_deref())?,
        path.as_deref(),
        line.unwrap_or(1),
    )
    .map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
pub struct ChangesReply {
    git: bool,
    files: Vec<Change>,
}

#[derive(Debug, Serialize)]
pub struct HeadReply {
    path: String,
    content: String,
    tracked: bool,
}

/// Saves a file over whatever is on disk now (the web app's behaviour); the write itself is still atomic and size-limited.
#[tauri::command]
pub fn local_put_file(
    state: State<AppState>,
    root: Option<String>,
    path: String,
    content: String,
) -> Result<String, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let current = workspace
        .current_hash(&path)
        .map_err(|error| error.to_string())?;

    workspace
        .write(&path, &content, current.as_deref())
        .map(|written| written.after)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_changes(state: State<AppState>, root: Option<String>) -> Result<ChangesReply, String> {
    let changes = git::changes(&state.workspace_for(root.as_deref())?);

    Ok(ChangesReply {
        git: changes.is_some(),
        files: changes.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn local_branches(state: State<AppState>, root: Option<String>) -> Result<Branches, String> {
    Ok(git::branches(&state.workspace_for(root.as_deref())?))
}

#[tauri::command]
pub fn local_head(
    state: State<AppState>,
    root: Option<String>,
    path: String,
) -> Result<HeadReply, String> {
    let head = git::head_content(&state.workspace_for(root.as_deref())?, &path)
        .map_err(|error| error.to_string())?;

    Ok(HeadReply {
        path,
        tracked: head.is_some(),
        content: head.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn local_discard(
    state: State<AppState>,
    root: Option<String>,
    path: String,
) -> Result<(), String> {
    git::discard(&state.workspace_for(root.as_deref())?, &path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_commit(
    state: State<AppState>,
    root: Option<String>,
    message: String,
) -> Result<Committed, String> {
    git::commit(&state.workspace_for(root.as_deref())?, &message).map_err(|error| error.to_string())
}

/// Commit title and description.
#[derive(Serialize)]
pub struct CommitMessage {
    title: String,
    description: String,
}

/// Has the AI write a commit message from the diff of the listed files; sends that diff to the Claude CLI.
#[tauri::command]
pub async fn local_commit_message(
    state: State<'_, AppState>,
    root: Option<String>,
) -> Result<CommitMessage, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let diff = git::diff_text(&workspace).map_err(|error| error.to_string())?;
        let prompt = format!(
            "Viết commit message cho thay đổi dưới đây. Dòng đầu là tiêu đề ngắn (tối đa 72 ký tự, không dấu chấm cuối), \
             sau đó một dòng trống rồi phần mô tả ngắn gọn. Chỉ trả về message, không giải thích, không dùng markdown.\n\n{diff}"
        );
        let answer = agent::ask_once(workspace.root(), &prompt, &[])
            .ok_or("AI chưa viết được nội dung. Kiểm tra Claude đã đăng nhập chưa.")?;
        let (title, description) = agent::split_message(&answer);

        Ok(CommitMessage { title, description })
    })
    .await
    .map_err(|_| "AI chưa viết được nội dung.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::EnvVar;
    use std::fs;

    fn state_with_projects(dir: &Path, folders: &[&Path]) -> (AppState, Vec<String>) {
        let state = AppState::new(
            ProjectStore::load(dir.join("rynox.db")),
            ChatStore::open(dir.join("rynox.db")),
        );
        let ids = folders
            .iter()
            .enumerate()
            .map(|(index, folder)| {
                state
                    .add_project(NewProject {
                        name: format!("p{index}"),
                        folders: vec![folder.display().to_string()],
                        env: vec![EnvVar {
                            key: "A".into(),
                            value: "1".into(),
                        }],
                    })
                    .unwrap()
                    .id
            })
            .collect();

        (state, ids)
    }

    #[test]
    fn selecting_a_project_switches_the_root_and_keeps_the_sandbox() {
        let data = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();

        fs::write(first.path().join("a.txt"), "first").unwrap();
        fs::write(second.path().join("b.txt"), "second").unwrap();
        fs::write(second.path().join(".env"), "SECRET=1").unwrap();

        let (state, ids) = state_with_projects(data.path(), &[first.path(), second.path()]);

        state.select_project(&ids[0]).unwrap();
        assert_eq!(state.workspace().unwrap().read("a.txt").unwrap(), "first");

        let info = state.select_project(&ids[1]).unwrap();
        let workspace = state.workspace().unwrap();

        assert_eq!(
            workspace.root(),
            fs::canonicalize(second.path()).unwrap().as_path()
        );
        assert_eq!(
            info.name,
            second.path().file_name().unwrap().to_string_lossy()
        );
        assert_eq!(workspace.read("b.txt").unwrap(), "second");
        assert!(workspace.read("a.txt").is_err());
        assert_eq!(workspace.read("../a.txt"), Err(WorkspaceError::BadPath));
        assert_eq!(workspace.read(".env"), Err(WorkspaceError::Denied));
        assert_eq!(state.list_projects().selected, Some(ids[1].clone()));
    }

    #[test]
    fn a_root_reaches_its_own_project_and_no_other_folder() {
        let data = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let stranger = tempfile::tempdir().unwrap();

        fs::write(first.path().join("a.txt"), "first").unwrap();
        fs::write(second.path().join("b.txt"), "second").unwrap();

        let (state, ids) = state_with_projects(data.path(), &[first.path(), second.path()]);
        let first_root = fs::canonicalize(first.path())
            .unwrap()
            .display()
            .to_string();
        let second_root = fs::canonicalize(second.path())
            .unwrap()
            .display()
            .to_string();

        state.select_project(&ids[1]).unwrap();

        // * The open workspace is the second project, yet the first one stays reachable by its root.
        let other = state.workspace_for(Some(&first_root)).unwrap();

        assert_eq!(other.read("a.txt").unwrap(), "first");
        assert_eq!(
            state
                .workspace_for(Some(&second_root))
                .unwrap()
                .read("b.txt")
                .unwrap(),
            "second"
        );
        assert_eq!(
            state.workspace_for(None).unwrap().read("b.txt").unwrap(),
            "second"
        );
        assert!(state
            .workspace_for(Some(&stranger.path().display().to_string()))
            .is_err());
    }

    #[test]
    fn failed_selection_keeps_the_current_workspace() {
        let data = tempfile::tempdir().unwrap();
        let open = tempfile::tempdir().unwrap();
        let doomed = tempfile::tempdir().unwrap();
        let doomed_path = doomed.path().to_path_buf();
        let (state, ids) = state_with_projects(data.path(), &[open.path(), &doomed_path]);

        state.select_project(&ids[0]).unwrap();
        drop(doomed);

        assert!(state.select_project(&ids[1]).is_err());
        assert!(state.select_project("p99").is_err());
        assert_eq!(state.list_projects().selected, Some(ids[0].clone()));
        assert_eq!(
            state.workspace().unwrap().root(),
            fs::canonicalize(open.path()).unwrap().as_path()
        );
    }

    #[test]
    fn project_without_folders_cannot_be_opened_and_removal_unselects() {
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let (state, ids) = state_with_projects(data.path(), &[folder.path()]);
        let empty = state
            .add_project(NewProject {
                name: "empty".into(),
                folders: vec![],
                env: vec![],
            })
            .unwrap();

        assert!(state.select_project(&empty.id).is_err());

        state.select_project(&ids[0]).unwrap();
        state.remove_project(&ids[0]).unwrap();

        assert_eq!(state.list_projects().selected, None);
        assert!(state.workspace().is_ok());
    }
}

/// One event of a chat turn, tagged with the turn it belongs to.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentPayload {
    run_id: String,
    #[serde(flatten)]
    event: agent::Event,
}

/// Starts one chat turn with `cli` in the open workspace and returns at once; the answer arrives as `agent-event` events tagged with `run_id`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn agent_send(
    app: AppHandle,
    state: State<AppState>,
    run_id: String,
    cli: String,
    prompt: String,
    session: Option<String>,
    model: Option<String>,
    mode: Option<String>,
    agent_team: bool,
    root: Option<String>,
) -> Result<(), String> {
    let cli = Cli::parse(&cli).ok_or("Chưa hỗ trợ CLI này.")?;

    if model
        .as_deref()
        .is_some_and(|name| !agent::valid_model(name))
    {
        return Err("Tên model không hợp lệ.".to_string());
    }

    if mode.as_deref().is_some_and(|name| !agent::valid_mode(name)) {
        return Err("Chế độ không hợp lệ.".to_string());
    }

    let root = state.workspace_for(root.as_deref())?.root().to_path_buf();
    // * Saved API keys go to the Claude CLI only; Codex has no key of its own here.
    let mut environment = if cli == Cli::Claude {
        app.state::<CredentialStore>().environment()
    } else {
        Vec::new()
    };

    // * Agent teams are an experimental feature of the Claude CLI, switched on through this variable.
    if agent_team && cli == Cli::Claude {
        environment.push(("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1".to_string()));
    }

    // * The chat runs under the account chosen for this CLI.
    environment.extend(app.state::<ProfileStore>().active_environment(cli.name()));

    std::thread::spawn(move || {
        agent::run_turn(
            cli,
            &root,
            &prompt,
            session.as_deref(),
            model.as_deref(),
            mode.as_deref(),
            &environment,
            |event| {
                let _ = app.emit(
                    "agent-event",
                    AgentPayload {
                        run_id: run_id.clone(),
                        event,
                    },
                );
            },
        );
    });

    Ok(())
}

/// What the chat panel restores when a workspace opens: its turns, its CLI session ids, and the key (`workspace`) to hand back when saving, so a late save never lands in another workspace.
#[derive(Debug, Serialize)]
pub struct ChatReply {
    workspace: String,
    #[serde(flatten)]
    history: ChatHistory,
}

#[tauri::command]
pub fn chat_load(
    state: State<AppState>,
    root: Option<String>,
    conversation: Option<i64>,
) -> Result<ChatReply, String> {
    let workspace = state
        .workspace_for(root.as_deref())?
        .root()
        .display()
        .to_string();
    let history = state
        .chats
        .lock()
        .expect("chats lock poisoned")
        .load(&workspace, conversation)
        .map_err(|error| error.to_string())?;

    Ok(ChatReply { workspace, history })
}

/// The conversations of the open workspace, the most recently used first.
#[tauri::command]
pub fn chat_list(
    state: State<AppState>,
    root: Option<String>,
) -> Result<Vec<Conversation>, String> {
    let workspace = state
        .workspace_for(root.as_deref())?
        .root()
        .display()
        .to_string();

    state
        .chats
        .lock()
        .expect("chats lock poisoned")
        .list(&workspace)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_save_turn(
    state: State<AppState>,
    workspace: String,
    conversation: i64,
    turn: ChatTurn,
) -> Result<(), String> {
    state
        .chats
        .lock()
        .expect("chats lock poisoned")
        .save_turn(&workspace, conversation, &turn)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_save_session(
    state: State<AppState>,
    workspace: String,
    conversation: i64,
    cli: String,
    session: String,
) -> Result<(), String> {
    state
        .chats
        .lock()
        .expect("chats lock poisoned")
        .save_session(&workspace, conversation, &cli, &session)
        .map_err(|error| error.to_string())
}

/// Saves a pasted image or file (the raw bytes are the request body, its name is in the `x-name` header, percent-encoded) and returns the path to give the CLI as `@path`.
#[tauri::command]
pub fn attachment_save(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(crate::attachments::AttachmentError::Empty.to_string());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| crate::attachments::AttachmentError::SaveFailed.to_string())?
        .join("attachments");

    crate::attachments::save(&dir, &name, data)
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

/// Bytes of a pasted image or file saved earlier by `attachment_save`, so the chat can show it; paths outside the attachments folder are refused.
#[tauri::command]
pub fn attachment_read(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| crate::attachments::AttachmentError::SaveFailed.to_string())?
        .join("attachments");

    crate::attachments::read(&dir, Path::new(&path))
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

/// Decodes `%XX` escapes (what `encodeURIComponent` produces); anything malformed is kept as it is.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        let escaped = (bytes[index] == b'%')
            .then(|| text.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());

        match escaped {
            Some(byte) => {
                decoded.push(byte);
                index += 3;
            }
            None => {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

#[cfg(test)]
mod attachment_tests {
    use super::percent_decode;

    #[test]
    fn percent_escapes_are_decoded_and_bad_ones_kept() {
        assert_eq!(percent_decode("a%20b.png"), "a b.png");
        assert_eq!(percent_decode("%E1%BA%A2nh.png"), "Ảnh.png");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }
}

/// Starts a new conversation and returns its id.
#[tauri::command]
pub fn chat_new(state: State<AppState>, workspace: String) -> Result<i64, String> {
    state
        .chats
        .lock()
        .expect("chats lock poisoned")
        .new_conversation(&workspace)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_delete(
    state: State<AppState>,
    root: Option<String>,
    conversation: i64,
) -> Result<(), String> {
    let workspace = state
        .workspace_for(root.as_deref())?
        .root()
        .display()
        .to_string();

    state
        .chats
        .lock()
        .expect("chats lock poisoned")
        .delete_conversation(&workspace, conversation)
        .map_err(|error| error.to_string())
}

/// Sign-in state of the AI CLIs (under their active account) and GitHub; runs the tools' status commands off the UI thread.
#[tauri::command]
pub async fn auth_status(app: AppHandle) -> Result<Vec<auth::ProviderStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let profiles = app.state::<ProfileStore>();

        auth::status_all(|provider| {
            provider
                .cli()
                .map(|cli| profiles.active_environment(cli))
                .unwrap_or_default()
        })
    })
    .await
    .map_err(|_| "Không đọc được trạng thái đăng nhập.".to_string())
}

/// Sign-in state of one AI CLI under the account `profile`.
#[tauri::command]
pub async fn auth_status_profile(
    app: AppHandle,
    provider: String,
    profile: i64,
) -> Result<auth::ProviderStatus, String> {
    let provider = auth::Provider::parse(&provider).ok_or("Chưa hỗ trợ tài khoản này.")?;

    tauri::async_runtime::spawn_blocking(move || {
        let environment = profile_environment(&app, provider, profile)?;

        Ok(auth::status(provider, &environment))
    })
    .await
    .map_err(|_| "Không đọc được trạng thái đăng nhập.".to_string())?
}

/// Plan usage (session and week limits) of a Claude account, from the CLI's own `/usage`; can take several seconds.
#[tauri::command]
pub async fn claude_usage_profile(
    app: AppHandle,
    profile: i64,
) -> Result<Option<Vec<auth::LimitUsage>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let environment = profile_environment(&app, auth::Provider::Claude, profile)?;

        Ok(auth::claude_usage(&environment))
    })
    .await
    .map_err(|_| "Không đọc được usage.".to_string())?
}

/// Starts the login flow of `provider` (`claude`, `codex` or `github`), for the account `profile` of an AI CLI (the default one when absent); GitHub returns the one-time code to type in the browser.
#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    provider: String,
    profile: Option<i64>,
) -> Result<Option<String>, String> {
    let provider = auth::Provider::parse(&provider).ok_or("Chưa hỗ trợ tài khoản này.")?;

    tauri::async_runtime::spawn_blocking(move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        auth::start_login(provider, &environment)
    })
    .await
    .map_err(|_| "Không bắt đầu được đăng nhập.".to_string())?
}

/// Signs the account `profile` of `provider` out with the tool's own logout command.
#[tauri::command]
pub async fn auth_logout(
    app: AppHandle,
    provider: String,
    profile: Option<i64>,
) -> Result<(), String> {
    let provider = auth::Provider::parse(&provider).ok_or("Chưa hỗ trợ tài khoản này.")?;

    tauri::async_runtime::spawn_blocking(move || {
        let environment =
            profile_environment(&app, provider, profile.unwrap_or(profiles::DEFAULT_PROFILE))?;

        auth::logout(provider, &environment)
    })
    .await
    .map_err(|_| "Không ngắt được kết nối.".to_string())?
}

/// Environment of the account `profile` for `provider`.
fn profile_environment(
    app: &AppHandle,
    provider: auth::Provider,
    profile: i64,
) -> Result<auth::Environment, String> {
    let Some(cli) = provider.cli() else {
        return Ok(Vec::new());
    };

    app.state::<ProfileStore>()
        .environment(cli, profile)
        .map_err(|error| error.to_string())
}
