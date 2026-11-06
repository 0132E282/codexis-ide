use super::state::AppState;
use crate::agent;
use crate::git::{self, Branches, Change, Committed};
use crate::profiles::ProfileStore;
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

    super::blocking("Không đọc được thay đổi.", move || {
        let changes = git::changes(&workspace);

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

    super::blocking("Không đọc được nhánh.", move || {
        Ok(git::branches(&workspace))
    })
    .await
}

#[tauri::command]
pub async fn local_head(
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
) -> Result<HeadReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("Không đọc được bản đã commit.", move || {
        let head = git::head_content(&workspace, &path).map_err(|error| error.to_string())?;

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
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("Không hoàn tác được tệp.", move || {
        git::discard(&workspace, &path).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn local_commit(
    state: State<'_, AppState>,
    root: Option<String>,
    message: String,
) -> Result<Committed, String> {
    let workspace = state.workspace_for(root.as_deref())?;

    super::blocking("Không commit được.", move || {
        git::commit(&workspace, &message).map_err(|error| error.to_string())
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
    let environment = profiles.active_environment("claude");

    super::blocking("AI chưa viết được nội dung.", move || {
        let diff = git::diff_text(&workspace).map_err(|error| error.to_string())?;
        let prompt = format!(
            "Viết commit message cho thay đổi dưới đây. Dòng đầu là tiêu đề ngắn (tối đa 72 ký tự, không dấu chấm cuối), \
             sau đó một dòng trống rồi phần mô tả ngắn gọn. Chỉ trả về message, không giải thích, không dùng markdown.\n\n{diff}"
        );
        let answer = agent::ask_once(workspace.root(), &prompt, &environment)
            .map_err(|error| format!("AI chưa viết được nội dung. {error}"))?;
        let (title, description) = agent::split_message(&answer);

        Ok(CommitMessage { title, description })
    })
    .await
}
