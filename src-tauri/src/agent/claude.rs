//! The Claude CLI as a chat agent: its arguments, its `stream-json` lines and the one-question `claude -p` call.

use super::{asks_person, text, AgentCli, Event, TurnOptions, PLAN_MODE, READ_ONLY_PLAN_MODE};
use crate::cli::{self, CliKind};
use crate::context::ContextUsage;
use crate::plan::Plan;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;

/// The system prompt of the chat (`prompts/chat/role.md` and `choices.md`).
const CHAT_ROLE: &str = concat!(
    include_str!("../../../prompts/chat/role.md"),
    "

",
    include_str!("../../../prompts/chat/choices.md")
);

pub struct ClaudeAgent;

impl AgentCli for ClaudeAgent {
    fn kind(&self) -> CliKind {
        CliKind::Claude
    }

    fn turn_args(&self, options: &TurnOptions<'_>) -> Vec<String> {
        let mut args = vec![
            "-p".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            // * Without this the CLI sends a text block only when it is complete, so the chat shows nothing while the model writes.
            "--include-partial-messages".to_string(),
            // * How the assistant works here (short answers, act without asking), added to the CLI's own prompt.
            "--append-system-prompt".to_string(),
            CHAT_ROLE.to_string(),
        ];

        if let Some(id) = options.session {
            args.push("--resume".to_string());
            args.push(id.to_string());
        }

        if let Some(mode) = options.mode {
            args.push("--permission-mode".to_string());
            // * The read-only plan mode is the CLI's `plan` mode without the questions below.
            args.push(
                if mode == READ_ONLY_PLAN_MODE {
                    PLAN_MODE
                } else {
                    mode
                }
                .to_string(),
            );

            // * "Hỏi từng việc" and plan mode: the CLI sends each permission question to this app on its output and waits for the answer on its input (only then it offers `ExitPlanMode`).
            if asks_person(Some(mode)) {
                args.extend(
                    [
                        "--input-format",
                        "stream-json",
                        "--permission-prompt-tool",
                        "stdio",
                    ]
                    .map(String::from),
                );
            }
        }

        if let Some(model) = options.model {
            args.push("--model".to_string());
            args.push(model.to_string());
        }

        // * Access to more project folders, next to the one the CLI runs in.
        for dir in options.add_dirs {
            args.push("--add-dir".to_string());
            args.push(dir.clone());
        }

        args
    }

    fn parse_line(&self, line: &str) -> Vec<Event> {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return Vec::new();
        };

        match value["type"].as_str() {
            Some("system") if value["subtype"] == "init" => text(value.get("session_id"))
                .map(Event::Session)
                .into_iter()
                .collect(),
            // * An account out of allowance gets an empty answer and only this event: without turning it into an error the chat stays silent and no other account is tried.
            Some("rate_limit_event") if value["rate_limit_info"]["status"] == "rejected" => {
                let window = value["rate_limit_info"]["rateLimitType"]
                    .as_str()
                    .unwrap_or("unknown");

                vec![Event::Error(format!("agent.limit_reached|{window}"))]
            }
            Some("control_request") if value["request"]["subtype"] == "can_use_tool" => {
                let request = &value["request"];
                // * The plan the agent presents (`ExitPlanMode`, input `{plan, planFilePath}`) goes to the plan pane before its question, once: the `assistant` line of the same call is not a source.
                let plan = request["tool_name"]
                    .as_str()
                    .and_then(|tool| Plan::from_tool(tool, &request["input"]))
                    .map(|plan| Event::Plan(plan.to_json()));

                plan.into_iter()
                    .chain([Event::Permission(
                        serde_json::json!({
                            "id": value["request_id"],
                            "tool": request["tool_name"],
                            "description": request["description"],
                            "input": request["input"],
                        })
                        .to_string(),
                    )])
                    .collect()
            }
            Some("stream_event") => {
                let event = &value["event"];

                // * What a sub-agent writes is shown in its own view, not in the answer of the main agent.
                if value["parent_tool_use_id"].is_null()
                    && event["type"] == "content_block_delta"
                    && event["delta"]["type"] == "text_delta"
                {
                    text(event["delta"].get("text"))
                        .map(Event::Delta)
                        .into_iter()
                        .collect()
                } else {
                    Vec::new()
                }
            }
            Some("assistant") => {
                // * Set for what happens inside a sub-agent: the id of the call that started it.
                let parent = value["parent_tool_use_id"].as_str();

                value["message"]["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .flat_map(|part| match (part["type"].as_str(), parent) {
                        (Some("text"), None) => text(part.get("text"))
                            .map(Event::Text)
                            .into_iter()
                            .collect(),
                        (Some("text"), Some(parent)) => text(part.get("text"))
                            .map(|text| {
                                Event::SubText(
                                    serde_json::json!({"parent": parent, "text": text}).to_string(),
                                )
                            })
                            .into_iter()
                            .collect(),
                        // * A sub-agent is a `Task` (newer CLIs: `Agent`) call of the main agent.
                        (Some("tool_use"), None) if is_subagent_call(part) => {
                            vec![tool_started(part, None), subagent_started(part)]
                        }
                        (Some("tool_use"), parent) => vec![tool_started(part, parent)],
                        _ => Vec::new(),
                    })
                    .collect()
            }
            // * The results of tool calls; for a sub-agent the result also means it is done.
            Some("user") => {
                let parent = value["parent_tool_use_id"].as_str();

                value["message"]["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|part| part["type"] == "tool_result")
                    .flat_map(|part| {
                        let id = part["tool_use_id"].as_str().unwrap_or_default().to_string();
                        let finished = tool_finished(part, parent);

                        match parent {
                            None => vec![finished, Event::SubagentDone(id)],
                            Some(_) => vec![finished],
                        }
                    })
                    .collect()
            }
            Some("result") if value["is_error"] == true => text(value.get("result"))
                .map(Event::Error)
                .into_iter()
                .collect(),
            Some("result") => context_event(&value).into_iter().collect(),
            _ => Vec::new(),
        }
    }

    fn background_change(&self, line: &str) -> Option<crate::background::BackgroundChange> {
        super::claude_background::change(line)
    }

    fn supports_ask_mode(&self) -> bool {
        true
    }

    fn turn_environment(&self, api_keys: cli::Environment, agent_team: bool) -> cli::Environment {
        let mut environment = api_keys;

        // * Agent teams are an experimental feature of the Claude CLI, switched on through this variable.
        if agent_team {
            environment.push(("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1".to_string()));
        }

        environment
    }
}

impl ClaudeAgent {
    /// Asks the Claude CLI one question and returns its plain answer; Err carries the real reason (CLI missing, stderr, exit code).
    pub fn ask_once(
        &self,
        root: &Path,
        prompt: &str,
        environment: &[(&str, String)],
    ) -> Result<String, String> {
        let program = cli::locate(CliKind::Claude.program())
            .ok_or_else(|| "agent.claude_missing".to_string())?;
        let mut child = cli::command(&program, environment)
            .arg("-p")
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("agent.claude_spawn_failed|{error}"))?;

        child
            .stdin
            .take()
            .ok_or_else(|| "agent.claude_stdin_failed".to_string())?
            .write_all(prompt.as_bytes())
            .map_err(|error| format!("agent.claude_send_failed|{error}"))?;

        let output = child
            .wait_with_output()
            .map_err(|error| format!("agent.claude_aborted|{error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if output.status.success() {
            return if stdout.is_empty() {
                Err("agent.claude_empty".to_string())
            } else {
                Ok(stdout)
            };
        }

        // * Auth failures are often printed on stdout, other errors on stderr: show whichever has text.
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = [stderr, stdout]
            .into_iter()
            .find(|text| !text.is_empty())
            .unwrap_or_else(|| "-".to_string());

        Err(format!("agent.claude_failed|{}: {detail}", output.status))
    }
}

/// Longest label or input shown for a tool call.
const MAX_TOOL_DETAIL_CHARS: usize = 80;
/// Longest tool output sent to the chat (the rest is cut).
const MAX_TOOL_OUTPUT_CHARS: usize = 2000;

/// The step for a `tool_use` part: tool name, the AI's own description of the call and what it works on (command, path, pattern...); an edit of a file also carries the text before and after, so the chat can show it as a diff.
fn tool_started(part: &serde_json::Value, parent: Option<&str>) -> Event {
    let input = &part["input"];
    let target = ["command", "file_path", "path", "pattern", "url", "prompt"]
        .iter()
        .find_map(|key| input[key].as_str())
        .unwrap_or_default();
    let mut step = serde_json::json!({
        "id": part["id"].as_str().unwrap_or_default(),
        "name": part["name"].as_str().unwrap_or("Tool"),
        "description": input["description"].as_str().unwrap_or_default(),
        "input": cut(target, MAX_TOOL_OUTPUT_CHARS),
    });

    if let Some(parent) = parent {
        step["parent"] = parent.into();
    }

    if let Some((before, after)) = file_change(part) {
        step["before"] = cut(&before, MAX_TOOL_OUTPUT_CHARS).into();
        step["after"] = cut(&after, MAX_TOOL_OUTPUT_CHARS).into();
    }

    Event::Tool(step.to_string())
}

/// The text a file edit (`Edit`, `MultiEdit`, `Write`) replaces and the text it puts there.
fn file_change(part: &serde_json::Value) -> Option<(String, String)> {
    let input = &part["input"];

    match part["name"].as_str()? {
        "Edit" => Some((
            input["old_string"].as_str()?.to_string(),
            input["new_string"].as_str()?.to_string(),
        )),
        "MultiEdit" => {
            let edits = input["edits"].as_array()?;
            let join = |key: &str| {
                edits
                    .iter()
                    .filter_map(|edit| edit[key].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            };

            Some((join("old_string"), join("new_string")))
        }
        "Write" => Some((String::new(), input["content"].as_str()?.to_string())),
        _ => None,
    }
}

/// The result of a tool call (`tool_result` part): its text, cut to a size the chat can show, and whether it failed.
fn tool_finished(part: &serde_json::Value, parent: Option<&str>) -> Event {
    let output = match &part["content"] {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter_map(|piece| piece["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };

    let mut result = serde_json::json!({
        "id": part["tool_use_id"].as_str().unwrap_or_default(),
        "output": cut(&output, MAX_TOOL_OUTPUT_CHARS),
        "error": part["is_error"] == true,
    });

    if let Some(parent) = parent {
        result["parent"] = parent.into();
    }

    Event::ToolResult(result.to_string())
}

/// `text` cut to `limit` characters.
fn cut(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// Whether a `tool_use` part starts a sub-agent.
fn is_subagent_call(part: &serde_json::Value) -> bool {
    matches!(part["name"].as_str(), Some("Task" | "Agent"))
}

/// The event for a sub-agent that was just started: its tool-call id and a short label (kind and description).
fn subagent_started(part: &serde_json::Value) -> Event {
    let input = &part["input"];
    let label = [
        input["subagent_type"].as_str(),
        input["description"].as_str(),
    ]
    .into_iter()
    .flatten()
    .filter(|piece| !piece.is_empty())
    .collect::<Vec<_>>()
    .join(": ");
    let label = cut(&label, MAX_TOOL_DETAIL_CHARS);

    Event::Subagent(
        serde_json::json!({
            "id": part["id"].as_str().unwrap_or_default(),
            "label": if label.is_empty() { "Agent".to_string() } else { label },
        })
        .to_string(),
    )
}
/// The context level after a turn, from its `result` line.
///
/// `result.usage` and `modelUsage` add up every model call of the turn, so they would overstate the context. The last call alone is `usage.iterations[-1]` (the `usage` of the last `assistant` message); `modelUsage.<model>.contextWindow` gives the window `[đã kiểm: claude 2.1.319]`.
fn context_event(result: &serde_json::Value) -> Option<Event> {
    let last_call = result["usage"]["iterations"].as_array()?.last()?;
    let (model, model_usage) = result["modelUsage"].as_object()?.iter().next()?;
    let window = model_usage["contextWindow"].as_u64();
    let context = ContextUsage::from_usage(CliKind::Claude, model, last_call, window)?;

    serde_json::to_string(&context).ok().map(Event::Context)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::ASK_MODE;

    fn mode_args(mode: Option<&str>) -> Vec<String> {
        ClaudeAgent.turn_args(&TurnOptions {
            session: None,
            model: None,
            mode,
            add_dirs: &[],
        })
    }

    #[test]
    fn claude_arguments_follow_the_documented_order() {
        let dirs = vec!["/a".to_string()];
        let args = ClaudeAgent.turn_args(&TurnOptions {
            session: Some("s"),
            model: Some("opus"),
            mode: Some(ASK_MODE),
            add_dirs: &dirs,
        });

        assert_eq!(
            args[..5],
            [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages"
            ]
        );
        assert_eq!(args[5], "--append-system-prompt");
        assert_eq!(
            args[7..],
            [
                "--resume",
                "s",
                "--permission-mode",
                "manual",
                "--input-format",
                "stream-json",
                "--permission-prompt-tool",
                "stdio",
                "--model",
                "opus",
                "--add-dir",
                "/a"
            ]
        );
    }

    #[test]
    fn only_claude_supports_ask_mode_and_api_keys() {
        let keys = vec![("ANTHROPIC_API_KEY", "k".to_string())];

        assert!(ClaudeAgent.supports_ask_mode());
        assert_eq!(ClaudeAgent.turn_environment(keys.clone(), false), keys);
        assert!(ClaudeAgent
            .turn_environment(Vec::new(), true)
            .contains(&("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1".to_string())));
    }

    #[test]
    fn rejected_rate_limit_becomes_a_limit_error() {
        let rejected = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}}"#;
        let allowed = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#;

        let events = ClaudeAgent.parse_line(rejected);

        assert!(matches!(
            events.as_slice(),
            [Event::Error(message)] if crate::usage::is_limit_error(message)
        ));
        assert!(ClaudeAgent.parse_line(allowed).is_empty());
    }

    #[test]
    fn ask_mode_has_the_cli_ask_this_app_and_a_tool_question_becomes_an_event() {
        let args = mode_args(Some(ASK_MODE));
        let line = r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Write","description":"a.txt","input":{"file_path":"/a.txt"}}}"#;

        assert!(args.contains(&"--permission-prompt-tool".to_string()));
        assert!(!mode_args(Some("auto")).contains(&"--permission-prompt-tool".to_string()));
        assert!(matches!(
            ClaudeAgent.parse_line(line).as_slice(),
            [Event::Permission(json)] if json.contains(r#""id":"r1""#) && json.contains(r#""tool":"Write""#)
        ));
        assert!(crate::agent::is_result_line(
            r#"{"type":"result","result":"x"}"#
        ));
        assert!(!crate::agent::is_result_line(
            r#"{"type":"assistant","text":"result"}"#
        ));
    }

    #[test]
    fn claude_init_gives_session_and_assistant_gives_text() {
        let init = r#"{"type":"system","subtype":"init","session_id":"abc"}"#;
        let reply = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}"#;

        assert_eq!(
            ClaudeAgent.parse_line(init),
            vec![Event::Session("abc".into())]
        );
        assert_eq!(
            ClaudeAgent.parse_line(reply),
            vec![Event::Text("Hi".into())]
        );
    }

    /// The JSON carried by a tool, sub-agent or result event.
    fn payload(event: &Event) -> serde_json::Value {
        match event {
            Event::Tool(json)
            | Event::ToolResult(json)
            | Event::Subagent(json)
            | Event::SubText(json) => serde_json::from_str(json).unwrap(),
            other => panic!("event without a payload: {other:?}"),
        }
    }

    #[test]
    fn claude_partial_text_gives_delta() {
        let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}"#;
        let other = r#"{"type":"stream_event","event":{"type":"content_block_start"}}"#;

        assert_eq!(
            ClaudeAgent.parse_line(delta),
            vec![Event::Delta("Hel".into())]
        );
        assert!(ClaudeAgent.parse_line(other).is_empty());
    }

    #[test]
    fn claude_tool_call_and_its_result_become_steps() {
        let call = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"b1","name":"Bash","input":{"command":"git status","description":"Show status"}}]}}"#;
        let done = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"b1","content":"clean","is_error":false}]}}"#;
        let failed = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"b2","content":[{"type":"text","text":"boom"}],"is_error":true}]}}"#;

        let started = ClaudeAgent.parse_line(call);

        assert_eq!(started.len(), 1);
        assert_eq!(
            payload(&started[0]),
            serde_json::json!({"id": "b1", "name": "Bash", "description": "Show status", "input": "git status"})
        );

        let finished = ClaudeAgent.parse_line(done);

        assert_eq!(
            payload(&finished[0]),
            serde_json::json!({"id": "b1", "output": "clean", "error": false})
        );
        assert_eq!(finished[1], Event::SubagentDone("b1".into()));
        assert_eq!(
            payload(&ClaudeAgent.parse_line(failed)[0]),
            serde_json::json!({"id": "b2", "output": "boom", "error": true})
        );
    }

    #[test]
    fn claude_file_edit_carries_the_text_before_and_after() {
        let edit = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"e1","name":"Edit","input":{"file_path":"a.rs","old_string":"x","new_string":"y"}}]}}"#;
        let write = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"w1","name":"Write","input":{"file_path":"b.rs","content":"new"}}]}}"#;

        let edited = payload(&ClaudeAgent.parse_line(edit)[0]);
        let written = payload(&ClaudeAgent.parse_line(write)[0]);

        assert_eq!(
            (edited["before"].as_str(), edited["after"].as_str()),
            (Some("x"), Some("y"))
        );
        assert_eq!(
            (written["before"].as_str(), written["after"].as_str()),
            (Some(""), Some("new"))
        );
    }

    #[test]
    fn claude_exit_plan_mode_request_gives_a_plan_then_the_question() {
        let request = r##"{"type":"control_request","request_id":"r9","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","display_name":"ExitPlanMode","input":{"plan":"# Kế hoạch\n- một","planFilePath":"/home/u/.claude/plans/x.md"},"tool_use_id":"toolu_1"}}"##;
        let events = ClaudeAgent.parse_line(request);

        let [Event::Plan(plan), Event::Permission(question)] = events.as_slice() else {
            panic!("expected a plan then a question, got {events:?}");
        };
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(plan).unwrap(),
            serde_json::json!({"kind": "text", "markdown": "# Kế hoạch\n- một"})
        );
        assert!(question.contains(r#""id":"r9""#) && question.contains(r#""tool":"ExitPlanMode""#));

        // * Other tools and a request without a plan only ask.
        let write = r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"/a"}}}"#;
        let empty = r#"{"type":"control_request","request_id":"r2","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{}}}"#;

        for line in [write, empty] {
            assert!(matches!(
                ClaudeAgent.parse_line(line).as_slice(),
                [Event::Permission(_)]
            ));
        }

        // * The `assistant` line of the same call is only a step, so the plan is not sent twice; no TodoWrite either.
        let assistant = r##"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"p1","name":"ExitPlanMode","input":{"plan":"# x"}},{"type":"tool_use","id":"p2","name":"TodoWrite","input":{"todos":[{"content":"a","status":"pending"}]}}]}}"##;
        let events = ClaudeAgent.parse_line(assistant);

        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| matches!(event, Event::Tool(_))));
    }

    #[test]
    fn claude_task_call_starts_a_subagent_and_its_result_ends_it() {
        let start = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"t1","name":"Task","input":{"subagent_type":"reviewer","description":"Check the diff"}}]}}"#;
        let inner = r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"ls"}}]}}"#;
        let inner_result = r#"{"type":"user","parent_tool_use_id":"t1","message":{"content":[{"type":"tool_result","tool_use_id":"t2"}]}}"#;
        let started = ClaudeAgent.parse_line(start);

        assert_eq!(started.len(), 2);
        assert_eq!(payload(&started[0])["name"], "Task");
        assert_eq!(
            payload(&started[1]),
            serde_json::json!({"id": "t1", "label": "reviewer: Check the diff"})
        );
        // * What happens inside a sub-agent is a step of that sub-agent (it names its parent), not of the main agent, and does not end it.
        let inner_call = ClaudeAgent.parse_line(inner);
        let inner_done = ClaudeAgent.parse_line(inner_result);

        assert_eq!(payload(&inner_call[0])["parent"], "t1");
        assert_eq!(inner_done.len(), 1);
        assert_eq!(payload(&inner_done[0])["parent"], "t1");
    }

    #[test]
    fn claude_sub_agent_words_stay_out_of_the_answer() {
        let words = r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"text","text":"working"}]}}"#;
        let delta = r#"{"type":"stream_event","parent_tool_use_id":"t1","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"wor"}}}"#;
        let spoken = ClaudeAgent.parse_line(words);

        assert_eq!(
            payload(&spoken[0]),
            serde_json::json!({"parent": "t1", "text": "working"})
        );
        assert!(ClaudeAgent.parse_line(delta).is_empty());
    }

    #[test]
    fn claude_error_result_gives_error() {
        let line = r#"{"type":"result","is_error":true,"result":"boom"}"#;

        assert_eq!(
            ClaudeAgent.parse_line(line),
            vec![Event::Error("boom".into())]
        );
    }

    #[test]
    fn a_result_gives_the_last_call_as_context_not_the_turn_total() {
        let multi = include_str!("fixtures/claude-result-multi-call.jsonl");
        let events = ClaudeAgent.parse_line(multi);
        let [Event::Context(json)] = events.as_slice() else {
            panic!("expected one context event: {events:?}");
        };
        let context: serde_json::Value = serde_json::from_str(json).unwrap();

        // 2 + 26588 + 390 of the last call, not the 60244 cache read summed over 3 calls.
        assert_eq!(context["used"], 26980);
        assert_eq!(context["window"], 1_000_000);
        assert_eq!(context["cacheRead"], 26588);
        assert_eq!(context["output"], 213);
        assert_eq!(context["model"], "claude-opus-5-5");
        assert!((context["percent"].as_f64().unwrap() - 2.698).abs() < 1e-9);

        let single = include_str!("fixtures/claude-result-single-call.jsonl");
        let events = ClaudeAgent.parse_line(single);
        let [Event::Context(json)] = events.as_slice() else {
            panic!("expected one context event: {events:?}");
        };
        let context: serde_json::Value = serde_json::from_str(json).unwrap();

        assert_eq!(context["used"], 2 + 12098 + 15789);
        assert_eq!(context["model"], "claude-sonnet-5-5");
    }

    #[test]
    fn a_result_without_usage_gives_no_context_and_an_error_result_stays_an_error() {
        assert!(ClaudeAgent
            .parse_line(r#"{"type":"result","is_error":false,"result":"ok"}"#)
            .is_empty());
        let zero = r#"{"type":"result","is_error":false,"usage":{"iterations":[{"input_tokens":0,"output_tokens":0}]},"modelUsage":{}}"#;
        assert!(ClaudeAgent.parse_line(zero).is_empty());
        let failed = r#"{"type":"result","is_error":true,"result":"limit","usage":{"iterations":[{"input_tokens":5}]},"modelUsage":{"m":{}}}"#;
        assert_eq!(
            ClaudeAgent.parse_line(failed),
            vec![Event::Error("limit".into())]
        );
    }

    #[test]
    fn lines_that_are_not_json_are_ignored() {
        assert!(ClaudeAgent.parse_line("not json").is_empty());
    }
}
