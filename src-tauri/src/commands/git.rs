use super::state::AppState;
use crate::agent::{self, ClaudeAgent};
use crate::cli::CliKind;
use crate::git::{Branches, Change, Committed, GitRepo};
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
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
) -> Result<(), String> {
    validation::relative_path(&path)?;

    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("git.restore_failed", move || {
        GitRepo::new(&workspace)
            .discard(&path)
            .map_err(|error| error.to_string())
    })
    .await
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
