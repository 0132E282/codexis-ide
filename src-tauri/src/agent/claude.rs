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
#[path = "../../tests/unit/agent_claude.rs"]
mod tests;
