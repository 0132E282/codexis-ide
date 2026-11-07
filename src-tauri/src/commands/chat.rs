use super::state::AppState;
use crate::chats::{ChatHistory, ChatTurn, Conversation};
use serde::Serialize;
use tauri::State;

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
    let workspace = state.workspace_key(root.as_deref())?;
    let history = state
        .lock_chats()
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
    let workspace = state.workspace_key(root.as_deref())?;

    state
        .lock_chats()
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
    let workspace = state.workspace_key(Some(&workspace))?;

    state
        .lock_chats()
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
    let workspace = state.workspace_key(Some(&workspace))?;

    state
        .lock_chats()
        .save_session(&workspace, conversation, &cli, &session)
        .map_err(|error| error.to_string())
}

/// Starts a new conversation and returns its id.
#[tauri::command]
pub fn chat_new(state: State<AppState>, workspace: String) -> Result<i64, String> {
    let workspace = state.workspace_key(Some(&workspace))?;

    state
        .lock_chats()
        .new_conversation(&workspace)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_delete(
    state: State<AppState>,
    root: Option<String>,
    conversation: i64,
) -> Result<(), String> {
    let workspace = state.workspace_key(root.as_deref())?;

    state
        .lock_chats()
        .delete_conversation(&workspace, conversation)
        .map_err(|error| error.to_string())
}
