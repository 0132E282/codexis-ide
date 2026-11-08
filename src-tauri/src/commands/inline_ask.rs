use super::state::AppState;
use crate::agent::ClaudeAgent;
use crate::cli::CliKind;
use crate::credentials::CredentialStore;
use crate::profiles::ProfileStore;
use crate::validation;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// Question about a snippet picked in the editor: the file, lines and code go to the Claude CLI.
fn inline_prompt(path: &str, start_line: u32, end_line: u32, text: &str, question: &str) -> String {
    let lines = if start_line == 0 || end_line == 0 {
        "whole file".to_string()
    } else if start_line == end_line {
        format!("line {start_line}")
    } else {
        format!("lines {start_line}-{end_line}")
    };

    format!(
        "Answer briefly and to the point, in the same language as the question. Only answer, do not edit files.\n\n\
         File: {path} ({lines})\n```\n{text}\n```\n\nQuestion: {question}"
    )
}

/// Answer of the AI to an inline question; `conversation` is a fixed tag, no history is kept.
#[derive(Serialize)]
pub struct InlineAnswer {
    answer: String,
    conversation: String,
}

/// Answers a question about picked lines with the Claude CLI run in the project root; denied files are refused.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn inline_ask(
    app: AppHandle,
    state: State<'_, AppState>,
    root: Option<String>,
    path: String,
    start_line: u32,
    end_line: u32,
    text: String,
    question: String,
) -> Result<InlineAnswer, String> {
    // * Shape of the input first: a NUL byte or an oversized snippet never reaches the workspace or the AI.
    validation::relative_path(&path)?;
    validation::snippet(&text)?;

    let workspace = state.workspace_for(root.as_deref())?;

    // * Same guard as reading a file: a denied name (.env, keys...) or a path outside the root never reaches the AI.
    let relative = workspace
        .allowed_relative(&path)
        .map_err(|error| error.to_string())?;

    if question.trim().is_empty() {
        return Err("inline.question_empty".to_string());
    }

    validation::question(&question)?;

    let mut environment = app.state::<CredentialStore>().environment();

    // * The same account as the chat: the one chosen for the Claude CLI, not the CLI's own login.
    environment.extend(
        app.state::<ProfileStore>()
            .active_environment(CliKind::Claude.name()),
    );
    let prompt = inline_prompt(&relative, start_line, end_line, &text, question.trim());

    super::blocking("inline.ask_failed", move || {
        let answer = ClaudeAgent.ask_once(workspace.root(), &prompt, &environment)?;

        Ok(InlineAnswer {
            answer,
            conversation: "inline".to_string(),
        })
    })
    .await
}

#[cfg(test)]
#[path = "../../tests/unit/commands_inline_ask.rs"]
mod tests;
