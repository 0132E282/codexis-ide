//! OpenClaw as a chat agent: `openclaw agent --json --message-file -` runs one turn and prints one JSON document at the end (no stream), so the chat shows the answer when the turn is done.
//! Mapped so far: the answer text (`payloads[].text`), the session id and a failed run (`ok: false`). Tools, usage, models and permission modes are not mapped yet.
//! `[chưa kiểm]` against a real `openclaw`: the fields of `openclaw agent --json` follow the docs of `agent exec --json`, which are the only ones fully specified.

use super::{text, AgentCli, Event, TurnOptions};
use crate::cli::CliKind;

/// The agent a turn without a session runs on: the command needs a selector, and `main` is OpenClaw's default agent `[chưa kiểm]`.
const DEFAULT_AGENT: &str = "main";

pub struct OpenClawAgent;

impl AgentCli for OpenClawAgent {
    fn kind(&self) -> CliKind {
        CliKind::OpenClaw
    }

    fn turn_args(&self, options: &TurnOptions<'_>) -> Vec<String> {
        let mut args = ["agent", "--json", "--message-file", "-"]
            .map(str::to_string)
            .to_vec();

        match options.session {
            Some(id) => args.extend(["--session-id".to_string(), id.to_string()]),
            None => args.extend(["--agent".to_string(), DEFAULT_AGENT.to_string()]),
        }

        if let Some(model) = options.model {
            args.extend(["--model".to_string(), model.to_string()]);
        }

        args
    }

    fn parse_line(&self, _line: &str) -> Vec<Event> {
        Vec::new()
    }

    fn prints_whole_output(&self) -> bool {
        true
    }

    fn parse_output(&self, output: &str) -> Vec<Event> {
        // * Warnings may come before the document: it starts at the first `{`.
        let Some(start) = output.find('{') else {
            return text_events(output.trim());
        };
        let Ok(value) = serde_json::Deserializer::from_str(&output[start..])
            .into_iter::<serde_json::Value>()
            .next()
            .unwrap_or(Ok(serde_json::Value::Null))
        else {
            return text_events(output.trim());
        };
        let mut events = Vec::new();

        if let Some(id) = text(value.get("sessionId")) {
            events.push(Event::Session(id));
        }

        if value["ok"] == false {
            events.push(Event::Error(
                text(value["error"].get("message")).unwrap_or_else(|| "openclaw".to_string()),
            ));

            return events;
        }

        let answer = value["payloads"]
            .as_array()
            .map(|payloads| {
                payloads
                    .iter()
                    .filter_map(|payload| text(payload.get("text")))
                    .collect::<Vec<_>>()
                    .join("\n\n")
            })
            .filter(|answer| !answer.is_empty())
            .or_else(|| text(value.get("final")));

        events.extend(answer.map(Event::Text));

        events
    }
}

fn text_events(output: &str) -> Vec<Event> {
    if output.is_empty() {
        Vec::new()
    } else {
        vec![Event::Text(output.to_string())]
    }
}

#[cfg(test)]
#[path = "../../tests/unit/agent_openclaw.rs"]
mod tests;
