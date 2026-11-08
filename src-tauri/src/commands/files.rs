use super::activity::{log_file_event, log_save};
use super::state::AppState;
use crate::activity::{FileAction, NewFileEvent};
use crate::{validation, vscode};
use serde::Serialize;
use tauri::{AppHandle, State};

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
    app: AppHandle,
    state: State<AppState>,
    root: Option<String>,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<String, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    // * The text before the save, only to count the lines the save changed; it is never stored.
    let before = workspace.read(&path).ok();
    let written = workspace
        .write(&path, &content, expected_hash.as_deref())
        .map_err(|error| error.to_string())?;

    log_save(&app, &workspace, &path, before.as_deref(), &content);

    Ok(written.after)
}

/// Saves a file over whatever is on disk now (the web app's behaviour); the write itself is still atomic and size-limited.
#[tauri::command]
pub fn local_put_file(
    app: AppHandle,
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

    let before = workspace.read_for_viewer(&path).ok();
    let written = workspace
        .write_for_viewer(&path, &content, current.as_deref())
        .map_err(|error| error.to_string())?;

    log_save(&app, &workspace, &path, before.as_deref(), &content);

    Ok(written.after)
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

/// The ESLint problems of the text of a file (none when it cannot be checked), found with the project's ESLint; runs `eslint` off the UI thread.
#[tauri::command]
pub async fn lint_code(
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
    content: String,
) -> Result<Vec<crate::linter::LintMessage>, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("files.lint_failed", move || {
        Ok(crate::linter::lint(&workspace, &path, &content))
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
    app: AppHandle,
    state: State<AppState>,
    root: Option<String>,
    path: String,
    new_name: String,
) -> Result<String, String> {
    validation::relative_path(&path)?;
    validation::entry_name(&new_name)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let renamed = workspace
        .rename_for_viewer(&path, &new_name)
        .map_err(|error| error.to_string())?;

    log_file_event(
        &app,
        &NewFileEvent::user(
            &workspace.root().display().to_string(),
            &renamed,
            FileAction::Rename,
        )
        .with_old_path(&path),
    );

    Ok(renamed)
}

/// Creates an empty file or folder named `name` inside `folder` (empty: the project root) and returns its path.
#[tauri::command]
pub fn workspace_create(
    app: AppHandle,
    state: State<AppState>,
    root: Option<String>,
    folder: String,
    name: String,
    is_folder: bool,
) -> Result<String, String> {
    validation::entry_name(&name)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let created = workspace
        .create_for_viewer(&folder, &name, is_folder)
        .map_err(|error| error.to_string())?;

    log_file_event(
        &app,
        &NewFileEvent {
            bytes_after: (!is_folder).then_some(0),
            ..NewFileEvent::user(
                &workspace.root().display().to_string(),
                &created,
                FileAction::Create,
            )
        },
    );

    Ok(created)
}

/// Copies a file or folder into `folder` (empty: the project root) under a free name and returns the new path.
#[tauri::command]
pub fn workspace_copy(
    app: AppHandle,
    state: State<AppState>,
    root: Option<String>,
    path: String,
    folder: String,
) -> Result<String, String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let copied = workspace
        .copy_for_viewer(&path, &folder)
        .map_err(|error| error.to_string())?;

    log_file_event(
        &app,
        &NewFileEvent::user(
            &workspace.root().display().to_string(),
            &copied,
            FileAction::Copy,
        )
        .with_old_path(&path),
    );

    Ok(copied)
}

/// Moves a file or folder into `folder` (empty: the project root), the drag and drop of the file tree, and returns the new path.
#[tauri::command]
pub fn workspace_move(
    app: AppHandle,
    state: State<AppState>,
    root: Option<String>,
    path: String,
    folder: String,
) -> Result<String, String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let moved = workspace
        .move_for_viewer(&path, &folder)
        .map_err(|error| error.to_string())?;

    log_file_event(
        &app,
        &NewFileEvent::user(
            &workspace.root().display().to_string(),
            &moved,
            FileAction::Move,
        )
        .with_old_path(&path),
    );

    Ok(moved)
}
