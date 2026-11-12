//! Keeps the content of `.env*` files out of the chat: the AI may read them, but what the tool returns is replaced before it is stored or shown.

use super::Event;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Mutex;

/// Shown in the chat instead of what a tool read from an env file.
const HIDDEN_OUTPUT: &str = "[hidden: .env content]";

/// Most tool calls on env files remembered at once; more are not tracked.
const MAX_TRACKED_CALLS: usize = 256;

/// Fields of a tool input that hold a path.
const PATH_FIELDS: [&str; 3] = ["file_path", "path", "notebook_path"];

/// Whether the last part of the path (after `/` or `\`) is `.env` or starts with `.env.`.
pub fn is_env_path(path: &str) -> bool {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);

    name == ".env" || name.starts_with(".env.")
}

/// Whether a tool call reads an env file: a path field of its input, or a token of its shell command, is an env path.
pub fn tool_reads_env(_name: &str, input: &Value) -> bool {
    let reads_path = PATH_FIELDS
        .iter()
        .any(|field| input[*field].as_str().is_some_and(is_env_path));

    if reads_path {
        return true;
    }

    // * A shell tool is named `Bash`, but any tool with a `command` is checked the same way, so the name is not needed.
    input["command"].as_str().is_some_and(|command| {
        command
            .split(|character: char| {
                character.is_whitespace()
                    || matches!(
                        character,
                        '\'' | '"' | ';' | '|' | '&' | '<' | '>' | '(' | ')'
                    )
            })
            .any(is_env_path)
    })
}

/// Remembers which tool calls read an env file, so the result of such a call can be hidden.
#[derive(Default)]
pub struct EnvGuard {
    calls: Mutex<HashSet<String>>,
}

impl EnvGuard {
    /// Returns the event unchanged, except the `ToolResult` of a call that read an env file: its output is replaced and its images dropped.
    pub fn filter(&self, event: Event) -> Event {
        match &event {
            Event::Tool(json) => {
                self.remember(json);
                event
            }
            Event::ToolResult(json) => match self.hide(json) {
                Some(hidden) => Event::ToolResult(hidden),
                None => event,
            },
            _ => event,
        }
    }

    fn remember(&self, json: &str) {
        let Ok(value) = serde_json::from_str::<Value>(json) else {
            return;
        };
        let Some(id) = value["id"].as_str() else {
            return;
        };

        if !tool_reads_env(value["name"].as_str().unwrap_or_default(), &value["input"]) {
            return;
        }

        if let Ok(mut calls) = self.calls.lock() {
            if calls.len() < MAX_TRACKED_CALLS {
                calls.insert(id.to_string());
            }
        }
    }

    /// The result JSON with its output hidden, or `None` when the call did not read an env file.
    fn hide(&self, json: &str) -> Option<String> {
        let mut value = serde_json::from_str::<Value>(json).ok()?;
        let id = value["id"].as_str()?.to_string();
        let tracked = self.calls.lock().ok()?.remove(&id);

        if !tracked {
            return None;
        }

        let object = value.as_object_mut()?;

        object.insert("output".to_string(), Value::from(HIDDEN_OUTPUT));
        object.remove("images");

        serde_json::to_string(&value).ok()
    }
}

#[cfg(test)]
#[path = "../../tests/unit/agent_env_guard.rs"]
mod tests;
