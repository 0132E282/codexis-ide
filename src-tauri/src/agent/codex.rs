//! The Codex CLI as a chat agent: its arguments and its `--json` lines.

use super::{text, AgentCli, Event, TurnOptions};
use crate::cli::CliKind;
use crate::context::ContextUsage;

pub struct CodexAgent;

impl AgentCli for CodexAgent {
    fn kind(&self) -> CliKind {
        CliKind::Codex
    }

    /// Flags that belong to `exec` (`--add-dir`, `-m`) go right after it, before `resume`; the prompt comes through stdin (`-`).
    fn turn_args(&self, options: &TurnOptions<'_>) -> Vec<String> {
        let mut args = vec!["exec".to_string()];

        for dir in options.add_dirs {
            args.push("--add-dir".to_string());
            args.push(dir.clone());
        }

        if let Some(model) = options.model {
            args.push("-m".to_string());
            args.push(model.to_string());
        }

        if let Some(id) = options.session {
            args.push("resume".to_string());
            args.push(id.to_string());
        }

        args.extend(["--json", "--skip-git-repo-check", "-"].map(String::from));

        args
    }

    fn parse_line(&self, line: &str) -> Vec<Event> {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return Vec::new();
        };

        match value["type"].as_str() {
            Some("thread.started") => text(value.get("thread_id"))
                .map(Event::Session)
                .into_iter()
                .collect(),
            Some("item.completed") if value["item"]["type"] == "agent_message" => {
                text(value["item"].get("text"))
                    .map(Event::Text)
                    .into_iter()
                    .collect()
            }
            // * [chưa kiểm] Codex could not be run to capture `turn.completed` (account limit), so the field names and `usage` being the last call are assumed. The model is not in the line, so the window is unknown until it is known some other way.
            Some("turn.completed") => {
                ContextUsage::from_usage(CliKind::Codex, "", &value["usage"], None)
                    .and_then(|context| serde_json::to_string(&context).ok())
                    .map(Event::Context)
                    .into_iter()
                    .collect()
            }
            Some("turn.failed") => text(value["error"].get("message"))
                .map(Event::Error)
                .into_iter()
                .collect(),
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_lines_map_to_events() {
        let thread = r#"{"type":"thread.started","thread_id":"t1"}"#;
        let message = r#"{"type":"item.completed","item":{"type":"agent_message","text":"Hi"}}"#;
        let notice = r#"{"type":"item.completed","item":{"type":"error","message":"noise"}}"#;
        let failed = r#"{"type":"turn.failed","error":{"message":"bad model"}}"#;

        assert_eq!(
            CodexAgent.parse_line(thread),
            vec![Event::Session("t1".into())]
        );
        assert_eq!(
            CodexAgent.parse_line(message),
            vec![Event::Text("Hi".into())]
        );
        assert!(CodexAgent.parse_line(notice).is_empty());
        assert_eq!(
            CodexAgent.parse_line(failed),
            vec![Event::Error("bad model".into())]
        );
        assert!(CodexAgent.parse_line("not json").is_empty());
    }

    #[test]
    fn codex_turn_completed_gives_context_assumed_format() {
        let done = r#"{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":20}}"#;
        let events = CodexAgent.parse_line(done);
        let [Event::Context(json)] = events.as_slice() else {
            panic!("expected one context event: {events:?}");
        };
        let context: serde_json::Value = serde_json::from_str(json).unwrap();

        assert_eq!(context["used"], 1000);
        assert_eq!(context["cacheRead"], 400);
        assert!(context["percent"].is_null());
        assert!(CodexAgent
            .parse_line(r#"{"type":"turn.completed"}"#)
            .is_empty());
    }

    #[test]
    fn codex_arguments_follow_the_documented_order() {
        let dirs = vec!["/a".to_string(), "/b".to_string()];
        let args = CodexAgent.turn_args(&TurnOptions {
            session: Some("s"),
            model: Some("gpt-5"),
            mode: Some("plan"),
            add_dirs: &dirs,
        });

        assert_eq!(
            args,
            [
                "exec",
                "--add-dir",
                "/a",
                "--add-dir",
                "/b",
                "-m",
                "gpt-5",
                "resume",
                "s",
                "--json",
                "--skip-git-repo-check",
                "-"
            ]
        );
    }
}
