use super::state::AppState;
use crate::{validation, vscode};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct Info {
    pub(super) name: String,
    /// Full path of the workspace root: the key the front end hands back (`root`) to address this project.
    root: String,
}

impl Info {
    pub(super) fn of(workspace: &crate::workspace::Workspace) -> Self {
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

/// Walks the whole project folder, so it runs on the blocking pool.
#[tauri::command]
pub async fn workspace_tree(
    state: State<'_, AppState>,
    root: Option<String>,
) -> Result<TreeReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("files.tree_failed", move || {
        let tree = workspace.tree();

        Ok(TreeReply {
            paths: tree.paths,
            truncated: tree.truncated,
        })
    })
    .await
}

#[tauri::command]
pub fn workspace_read(
    state: State<AppState>,
    root: Option<String>,
    path: String,
) -> Result<FileReply, String> {
    let content = state
        .workspace_for(root.as_deref())?
        .read_for_viewer(&path)
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

/// Saves a file over whatever is on disk now (the web app's behaviour); the write itself is still atomic and size-limited.
#[tauri::command]
pub fn local_put_file(
    state: State<AppState>,
    root: Option<String>,
    path: String,
    content: String,
) -> Result<String, String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let current = workspace
        .current_hash_for_viewer(&path)
        .map_err(|error| error.to_string())?;

    workspace
        .write_for_viewer(&path, &content, current.as_deref())
        .map(|written| written.after)
        .map_err(|error| error.to_string())
}

/// The text of a file formatted with the project's Prettier (unchanged when it cannot be formatted); runs `prettier` off the UI thread.
#[tauri::command]
pub async fn format_code(
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
    content: String,
) -> Result<String, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("files.format_failed", move || {
        Ok(crate::formatter::format(&workspace, &path, &content))
    })
    .await
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

/// Renames a file or folder in place (the person's action in the file tree) and returns its new path.
#[tauri::command]
pub fn workspace_rename(
    state: State<AppState>,
    root: Option<String>,
    path: String,
    new_name: String,
) -> Result<String, String> {
    validation::relative_path(&path)?;
    validation::entry_name(&new_name)?;

    state
        .workspace_for(root.as_deref())?
        .rename_for_viewer(&path, &new_name)
        .map_err(|error| error.to_string())
}
