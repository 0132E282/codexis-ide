use super::state::AppState;
use crate::agent::{self, ClaudeAgent};
use crate::cli::CliKind;
use crate::git::{Branches, Change, Committed, GitRepo};
use crate::git_history::{
    BlameLine, BranchCompare, BranchesInfo, CommitFile, CommitInfo, FileDiff, GitHistory,
    HistoryCache,
};
use crate::profiles::ProfileStore;
use crate::validation;
use serde::Serialize;
use tauri::State;

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

/// Commit title and description.
#[derive(Serialize)]
pub struct CommitMessage {
    title: String,
    description: String,
}

// * The git commands start `git` processes, so each runs on the blocking pool, not the UI thread.
#[tauri::command]
pub async fn local_changes(
    state: State<'_, AppState>,
    root: Option<String>,
) -> Result<ChangesReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.changes_failed", move || {
        let changes = GitRepo::new(&workspace).changes();

        Ok(ChangesReply {
            git: changes.is_some(),
            files: changes.unwrap_or_default(),
        })
    })
    .await
}

#[tauri::command]
pub async fn local_branches(
    state: State<'_, AppState>,
    root: Option<String>,
) -> Result<Branches, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.branches_failed", move || {
        Ok(GitRepo::new(&workspace).branches())
    })
    .await
}

#[tauri::command]
pub async fn local_head(
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
) -> Result<HeadReply, String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.head_failed", move || {
        let head = GitRepo::new(&workspace)
            .head_content(&path)
            .map_err(|error| error.to_string())?;

        Ok(HeadReply {
            path,
            tracked: head.is_some(),
            content: head.unwrap_or_default(),
        })
    })
    .await
}

#[tauri::command]
pub async fn local_discard(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
) -> Result<(), String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let event = crate::activity::NewFileEvent::user(
        &workspace.root().display().to_string(),
        &path,
        crate::activity::FileAction::Discard,
    );

    super::blocking("git.restore_failed", move || {
        GitRepo::new(&workspace)
            .discard(&path)
            .map_err(|error| error.to_string())
    })
    .await?;

    super::activity::log_file_event(&app, &event);

    Ok(())
}

#[tauri::command]
pub async fn local_commit(
    state: State<'_, AppState>,
    root: Option<String>,
    message: String,
) -> Result<Committed, String> {
    validation::commit_message(&message)?;

    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.commit_failed", move || {
        GitRepo::new(&workspace)
            .commit(&message)
            .map_err(|error| error.to_string())
    })
    .await
}

/// Has the AI write a commit message from the diff of the listed files; sends that diff to the Claude CLI.
#[tauri::command]
pub async fn local_commit_message(
    state: State<'_, AppState>,
    profiles: State<'_, ProfileStore>,
    root: Option<String>,
) -> Result<CommitMessage, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    // * The same account as the chat: the one chosen for the Claude CLI.
    let environment = profiles.active_environment(CliKind::Claude.name());

    super::blocking("git.ai_message_failed", move || {
        let diff = GitRepo::new(&workspace).diff_text().map_err(|error| error.to_string())?;
        let prompt = format!(
            "Viết commit message cho thay đổi dưới đây. Dòng đầu là tiêu đề ngắn (tối đa 72 ký tự, không dấu chấm cuối), \
             sau đó một dòng trống rồi phần mô tả ngắn gọn. Chỉ trả về message, không giải thích, không dùng markdown.\n\n{diff}"
        );
        let answer = ClaudeAgent.ask_once(workspace.root(), &prompt, &environment)?;
        let (title, description) = agent::split_message(&answer);

        Ok(CommitMessage { title, description })
    })
    .await
}

// * Read-only history commands: the front end shows an empty state for the `git.not_repository` error.
#[tauri::command]
pub async fn git_log(
    state: State<'_, AppState>,
    cache: State<'_, HistoryCache>,
    root: Option<String>,
    branch: Option<String>,
    limit: u32,
    skip: u32,
) -> Result<Vec<CommitInfo>, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let cache = cache.inner().clone();

    super::blocking("git.history_failed", move || {
        GitHistory::with_cache(&workspace, &cache)
            .log(branch.as_deref(), limit, skip)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_commit_files(
    state: State<'_, AppState>,
    cache: State<'_, HistoryCache>,
    root: Option<String>,
    hash: String,
) -> Result<Vec<CommitFile>, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let cache = cache.inner().clone();

    super::blocking("git.history_failed", move || {
        GitHistory::with_cache(&workspace, &cache)
            .commit_files(&hash)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_commit_file_diff(
    state: State<'_, AppState>,
    cache: State<'_, HistoryCache>,
    root: Option<String>,
    hash: String,
    path: String,
) -> Result<FileDiff, String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let cache = cache.inner().clone();

    super::blocking("git.history_failed", move || {
        GitHistory::with_cache(&workspace, &cache)
            .commit_file_diff(&hash, &path)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_file_history(
    state: State<'_, AppState>,
    cache: State<'_, HistoryCache>,
    root: Option<String>,
    path: String,
    limit: u32,
    skip: u32,
) -> Result<Vec<CommitInfo>, String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let cache = cache.inner().clone();

    super::blocking("git.history_failed", move || {
        GitHistory::with_cache(&workspace, &cache)
            .file_history(&path, limit, skip)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_blame(
    state: State<'_, AppState>,
    cache: State<'_, HistoryCache>,
    root: Option<String>,
    path: String,
) -> Result<Vec<BlameLine>, String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;
    let cache = cache.inner().clone();

    super::blocking("git.history_failed", move || {
        GitHistory::with_cache(&workspace, &cache)
            .blame(&path)
            .map(|lines| lines.as_ref().clone())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_branches_info(
    state: State<'_, AppState>,
    cache: State<'_, HistoryCache>,
    root: Option<String>,
) -> Result<BranchesInfo, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let cache = cache.inner().clone();

    super::blocking("git.history_failed", move || {
        Ok(GitHistory::with_cache(&workspace, &cache).branches_info())
    })
    .await
}

#[tauri::command]
pub async fn git_branch_compare(
    state: State<'_, AppState>,
    cache: State<'_, HistoryCache>,
    root: Option<String>,
    base: String,
    head: String,
) -> Result<BranchCompare, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let cache = cache.inner().clone();

    super::blocking("git.history_failed", move || {
        GitHistory::with_cache(&workspace, &cache)
            .branch_compare(&base, &head)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_checkout(
    state: State<'_, AppState>,
    root: Option<String>,
    branch: String,
) -> Result<String, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.checkout_failed", move || {
        GitHistory::new(&workspace)
            .checkout(&branch)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_merge(
    state: State<'_, AppState>,
    root: Option<String>,
    branch: String,
) -> Result<String, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.merge_failed", move || {
        GitHistory::new(&workspace)
            .merge(&branch)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_pull(state: State<'_, AppState>, root: Option<String>) -> Result<String, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.pull_failed", move || {
        GitHistory::new(&workspace)
            .pull()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_outgoing(
    state: State<'_, AppState>,
    root: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.history_failed", move || {
        GitHistory::new(&workspace)
            .outgoing()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_push(state: State<'_, AppState>, root: Option<String>) -> Result<String, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.push_failed", move || {
        GitHistory::new(&workspace)
            .push()
            .map_err(|error| error.to_string())
    })
    .await
}
