//! The Antigravity CLI (`agy`) as a chat agent: `agy --print=<prompt> --output-format stream-json`, one JSON object per line with an `event` field (`init`, `step_update`, `result`).
//! Mapped so far: the conversation id, the answer text (deltas) and a failed result. Tool steps, usage and context are not mapped yet.

use super::{text, AgentCli, Event, TurnOptions};
use crate::cli::CliKind;

pub struct AntigravityAgent;

impl AgentCli for AntigravityAgent {
    fn kind(&self) -> CliKind {
        CliKind::Antigravity
    }

    fn turn_args(&self, options: &TurnOptions<'_>) -> Vec<String> {
        let mut args = vec!["--output-format".to_string(), "stream-json".to_string()];

        for dir in options.add_dirs {
            args.push("--add-dir".to_string());
            args.push(dir.clone());
        }

        if let Some(model) = options.model {
            args.push("--model".to_string());
            args.push(model.to_string());
        }

        if let Some(id) = options.session {
            args.push("--conversation".to_string());
            args.push(id.to_string());
        }

        args
    }

    /// Attached with `=`: the CLI refuses a prompt that could be read as a flag, and the prompt is not read from stdin in print mode.
    fn prompt_args(&self, prompt: &str) -> Vec<String> {
        vec![format!("--print={prompt}")]
    }

    fn parse_line(&self, line: &str) -> Vec<Event> {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return Vec::new();
        };

        match value["event"].as_str() {
            Some("init") => text(value.get("conversation_id"))
                .map(Event::Session)
                .into_iter()
                .collect(),
            Some("step_update") => {
                let step = &value["step_update"];

                if step["step_type"] == "agent_response" {
                    text(step.get("text_delta"))
                        .map(Event::Delta)
                        .into_iter()
                        .collect()
                } else {
                    Vec::new()
                }
            }
            Some("result") if value["result"]["status"] != "SUCCESS" => {
                let result = &value["result"];

                vec![Event::Error(
                    text(result.get("response"))
                        .or_else(|| text(result.get("status")))
                        .unwrap_or_default(),
                )]
            }
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
#[path = "../../tests/unit/agent_antigravity.rs"]
mod tests;
