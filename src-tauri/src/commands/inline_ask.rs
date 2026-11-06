use super::state::AppState;
use crate::agent;
use crate::credentials::CredentialStore;
use crate::profiles::ProfileStore;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// Question about a snippet picked in the editor: the file, lines and code go to the Claude CLI.
fn inline_prompt(path: &str, start_line: u32, end_line: u32, text: &str, question: &str) -> String {
    let lines = if start_line == 0 || end_line == 0 {
        "cả tệp".to_string()
    } else if start_line == end_line {
        format!("dòng {start_line}")
    } else {
        format!("dòng {start_line}-{end_line}")
    };

    format!(
        "Trả lời ngắn gọn, đúng trọng tâm, bằng đúng ngôn ngữ của câu hỏi. Chỉ trả lời, không sửa tệp.\n\n\
         Tệp: {path} ({lines})\n```\n{text}\n```\n\nCâu hỏi: {question}"
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
    let workspace = state.workspace_for(root.as_deref())?;

    // * Same guard as reading a file: a denied name (.env, keys...) or a path outside the root never reaches the AI.
    let relative = workspace
        .allowed_relative(&path)
        .map_err(|error| error.to_string())?;

    if question.trim().is_empty() {
        return Err("Hãy nhập câu hỏi.".to_string());
    }

    let mut environment = app.state::<CredentialStore>().environment();

    // * The same account as the chat: the one chosen for the Claude CLI, not the CLI's own login.
    environment.extend(app.state::<ProfileStore>().active_environment("claude"));
    let prompt = inline_prompt(&relative, start_line, end_line, &text, question.trim());

    super::blocking("AI chưa trả lời được.", move || {
        let answer = agent::ask_once(workspace.root(), &prompt, &environment)
            .map_err(|error| format!("AI chưa trả lời được. {error}"))?;

        Ok(InlineAnswer {
            answer,
            conversation: "inline".to_string(),
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::inline_prompt;

    #[test]
    fn inline_prompt_names_file_lines_code_and_question() {
        let prompt = inline_prompt("src/a.rs", 3, 5, "let x = 1;", "Giải thích");

        assert!(prompt.contains("Tệp: src/a.rs (dòng 3-5)"));
        assert!(prompt.contains("```\nlet x = 1;\n```"));
        assert!(prompt.ends_with("Câu hỏi: Giải thích"));
        assert!(inline_prompt("a", 4, 4, "", "q").contains("(dòng 4)"));
        assert!(inline_prompt("a", 0, 0, "", "q").contains("(cả tệp)"));
    }
}
