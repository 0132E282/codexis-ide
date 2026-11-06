//! Chat with an AI CLI (`claude` or `codex`): one turn runs the CLI non-interactively in the workspace folder and its JSON lines are turned into events for the chat.
//! The CLIs keep their default permissions, so a turn can read the project but cannot write to it unasked.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

/// Folders searched after `PATH`: a desktop app does not inherit the shell's `PATH`, so the usual install places are tried as well.
const EXTRA_BIN_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", ".local/bin"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cli {
    Claude,
    Codex,
}

/// The system prompt of the chat (`prompts/chat/role.md` and `choices.md`).
const CHAT_ROLE: &str = concat!(
    include_str!("../../prompts/chat/role.md"),
    "\n\n",
    include_str!("../../prompts/chat/choices.md")
);

impl Cli {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    /// Name used for the CLI in profiles and statistics.
    pub fn name(self) -> &'static str {
        self.program()
    }

    fn program(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    /// Arguments of one turn; the prompt itself goes through stdin, so it can never be read as a flag.
    fn args(self, session: Option<&str>, model: Option<&str>, mode: Option<&str>) -> Vec<String> {
        let strings = |items: &[&str]| items.iter().map(|item| item.to_string()).collect();
        let mut args: Vec<String> = match self {
            Self::Claude => strings(&[
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                // * Without this the CLI sends a text block only when it is complete, so the chat shows nothing while the model writes.
                "--include-partial-messages",
                // * How the assistant works here (short answers, act without asking), added to the CLI's own prompt.
                "--append-system-prompt",
                CHAT_ROLE,
            ]),
            Self::Codex => strings(&["exec", "--json", "--skip-git-repo-check"]),
        };

        match (self, session) {
            (Self::Claude, Some(id)) => {
                args.push("--resume".to_string());
                args.push(id.to_string());
            }
            (Self::Codex, Some(id)) => {
                args.insert(1, "resume".to_string());
                args.insert(2, id.to_string());
                args.push("-".to_string());
            }
            (Self::Codex, None) => args.push("-".to_string()),
            (Self::Claude, None) => {}
        }

        // * Only Claude has permission modes; Codex ignores one.
        if let (Self::Claude, Some(mode)) = (self, mode) {
            args.push("--permission-mode".to_string());
            args.push(mode.to_string());

            // * "Hỏi từng việc": the CLI sends each permission question to this app on its output and waits for the answer on its input.
            if mode == ASK_MODE {
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

        if let Some(model) = model {
            match self {
                Self::Claude => {
                    args.push("--model".to_string());
                    args.push(model.to_string());
                }
                // * `-m` belongs to `exec`, so it goes right after it, before `resume`.
                Self::Codex => {
                    args.insert(1, "-m".to_string());
                    args.insert(2, model.to_string());
                }
            }
        }

        args
    }
}

/// Gives the CLI access to more project folders (`--add-dir`), next to the one it runs in.
pub fn with_add_dirs(cli: Cli, mut args: Vec<String>, add_dirs: &[String]) -> Vec<String> {
    for (offset, dir) in add_dirs.iter().enumerate() {
        match cli {
            Cli::Claude => {
                args.push("--add-dir".to_string());
                args.push(dir.clone());
            }
            // * Like `-m`, the flag belongs to `exec`, so it goes right after it, before `resume`.
            Cli::Codex => {
                args.insert(1 + offset * 2, "--add-dir".to_string());
                args.insert(2 + offset * 2, dir.clone());
            }
        }
    }

    args
}

/// What the chat receives while a turn runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "text", rename_all = "lowercase")]
pub enum Event {
    /// The id to pass back as `session` so the next turn continues this conversation.
    Session(String),
    Text(String),
    /// A piece of the answer that is still being written; the chat appends it as it is.
    Delta(String),
    /// A tool call of the agent, as JSON `{"id", "name", "description", "input"}`: the chat shows it as a step. A call made inside a sub-agent also has `"parent"`, the id of that sub-agent.
    Tool(String),
    /// What a tool call returned, as JSON `{"id", "output", "error"}` (and `"parent"` inside a sub-agent).
    ToolResult(String),
    /// Words a sub-agent wrote, as JSON `{"parent", "text"}`.
    SubText(String),
    /// A sub-agent the agent started: JSON `{"id": ..., "label": ...}`, listed in the sidebar while it works.
    Subagent(String),
    /// The id of a sub-agent that has finished.
    SubagentDone(String),
    /// The CLI asks whether it may use a tool, as JSON `{"id", "tool", "description", "input"}`; answered with `respond`.
    Permission(String),
    Error(String),
    /// The CLI exited; always the last event of a turn.
    Done(String),
}

/// Events carried by one output line of the CLI (empty for lines the chat does not show).
pub fn parse_line(cli: Cli, line: &str) -> Vec<Event> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return Vec::new();
    };
    let text = |value: Option<&serde_json::Value>| {
        value
            .and_then(|value| value.as_str())
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };

    match (cli, value["type"].as_str()) {
        (Cli::Claude, Some("system")) if value["subtype"] == "init" => {
            text(value.get("session_id"))
                .map(Event::Session)
                .into_iter()
                .collect()
        }
        // * An account out of allowance gets an empty answer and only this event: without turning it into an error the chat stays silent and no other account is tried.
        (Cli::Claude, Some("rate_limit_event"))
            if value["rate_limit_info"]["status"] == "rejected" =>
        {
            let window = value["rate_limit_info"]["rateLimitType"]
                .as_str()
                .unwrap_or("unknown");

            vec![Event::Error(format!(
                "Tài khoản đã hết hạn mức ({window}): usage limit reached."
            ))]
        }
        (Cli::Claude, Some("control_request")) if value["request"]["subtype"] == "can_use_tool" => {
            let request = &value["request"];

            vec![Event::Permission(
                serde_json::json!({
                    "id": value["request_id"],
                    "tool": request["tool_name"],
                    "description": request["description"],
                    "input": request["input"],
                })
                .to_string(),
            )]
        }
        (Cli::Claude, Some("stream_event")) => {
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
        (Cli::Claude, Some("assistant")) => {
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
        (Cli::Claude, Some("user")) => {
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
        (Cli::Claude, Some("result")) if value["is_error"] == true => text(value.get("result"))
            .map(Event::Error)
            .into_iter()
            .collect(),
        (Cli::Codex, Some("thread.started")) => text(value.get("thread_id"))
            .map(Event::Session)
            .into_iter()
            .collect(),
        (Cli::Codex, Some("item.completed")) if value["item"]["type"] == "agent_message" => {
            text(value["item"].get("text"))
                .map(Event::Text)
                .into_iter()
                .collect()
        }
        (Cli::Codex, Some("turn.failed")) => text(value["error"].get("message"))
            .map(Event::Error)
            .into_iter()
            .collect(),
        _ => Vec::new(),
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

/// Full path of the CLI, searched in `PATH` first and then in the usual install folders.
pub(crate) fn locate(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let extra = EXTRA_BIN_DIRS.iter().map(|dir| match &home {
        Some(home) if !dir.starts_with('/') => home.join(dir),
        _ => PathBuf::from(dir),
    });

    std::env::split_paths(&path)
        .chain(extra)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

/// Longest model name accepted.
const MAX_MODEL_CHARS: usize = 100;

/// A model name for `--model` / `-m`: letters, digits and `. _ : -`, never starting with `-`, so it cannot be read as another flag.
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.chars().count() <= MAX_MODEL_CHARS
        && !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// The permission mode in which every tool use is asked of the person.
pub const ASK_MODE: &str = "manual";

/// The input of a running CLI that waits for answers to its permission questions; emptied when the turn's result arrives, which lets the CLI exit.
pub type Responder = Arc<Mutex<Option<ChildStdin>>>;

/// Answers one permission question of the CLI: allow it to run with `input`, or deny it.
///
/// # Errors
/// Fails when the turn has already ended or the CLI no longer reads its input.
pub fn respond(
    responder: &Responder,
    request_id: &str,
    allow: bool,
    input: &serde_json::Value,
) -> Result<(), String> {
    let decision = if allow {
        serde_json::json!({"behavior": "allow", "updatedInput": input})
    } else {
        serde_json::json!({"behavior": "deny", "message": "Người dùng từ chối."})
    };
    let line = serde_json::json!({
        "type": "control_response",
        "response": {"subtype": "success", "request_id": request_id, "response": decision},
    });
    let mut guard = responder
        .lock()
        .map_err(|_| "Không gửi được câu trả lời.".to_string())?;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "Lượt này đã kết thúc.".to_string())?;

    writeln!(stdin, "{line}")
        .and_then(|()| stdin.flush())
        .map_err(|_| "Không gửi được câu trả lời.".to_string())
}

/// Whether a line of the CLI's output is the final result of the turn.
fn is_result_line(line: &str) -> bool {
    line.contains("\"result\"")
        && serde_json::from_str::<serde_json::Value>(line)
            .is_ok_and(|value| value["type"] == "result")
}

/// Permission modes of the Claude CLI the chat offers (`--permission-mode`).
const MODES: [&str; 4] = ["plan", "auto", "acceptEdits", "manual"];

/// Whether `mode` is one of the permission modes the chat offers.
pub fn valid_mode(mode: &str) -> bool {
    MODES.contains(&mode)
}

/// Runs one turn in `root` and calls `emit` for every event; the last one is always `Event::Done`.
#[allow(clippy::too_many_arguments)]
pub fn run_turn(
    cli: Cli,
    root: &Path,
    prompt: &str,
    session: Option<&str>,
    model: Option<&str>,
    mode: Option<&str>,
    add_dirs: &[String],
    environment: &[(&str, String)],
    responder: Option<&Responder>,
    on_spawn: impl Fn(u32),
    emit: impl Fn(Event),
) {
    let Some(program) = locate(cli.program()) else {
        emit(Event::Error(format!(
            "Không tìm thấy lệnh `{}`. Cài CLI này rồi thử lại.",
            cli.program()
        )));
        emit(Event::Done(String::new()));

        return;
    };

    let spawned = Command::new(program)
        .args(with_add_dirs(cli, cli.args(session, model, mode), add_dirs))
        .current_dir(root)
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(_) => {
            emit(Event::Error(format!(
                "Không chạy được `{}`.",
                cli.program()
            )));
            emit(Event::Done(String::new()));

            return;
        }
    };

    on_spawn(child.id());

    if let Some(mut stdin) = child.stdin.take() {
        match responder {
            // * The input stays open: the CLI's permission questions are answered on it until the turn's result.
            Some(responder) => {
                let message = serde_json::json!({
                    "type": "user",
                    "message": {"role": "user", "content": prompt},
                });
                let _ = writeln!(stdin, "{message}").and_then(|()| stdin.flush());

                if let Ok(mut guard) = responder.lock() {
                    *guard = Some(stdin);
                }
            }
            // Dropping stdin at the end of this block closes it, which is what tells the CLI the prompt is complete.
            None => {
                let _ = stdin.write_all(prompt.as_bytes());
            }
        }
    }

    if let Some(stdout) = child.stdout.take() {
        // * The complete text message that follows its own deltas would show the same words twice; without deltas (an old CLI) it is the only source.
        let mut streamed = false;
        // * Ids of the sub-agents started in this turn: only their results are reported as "done".
        let mut subagents = std::collections::HashSet::new();

        for line in std::io::BufRead::lines(std::io::BufReader::new(stdout)).map_while(Result::ok) {
            if let Some(responder) = responder {
                if is_result_line(&line) {
                    if let Ok(mut guard) = responder.lock() {
                        guard.take();
                    }
                }
            }

            for event in parse_line(cli, &line) {
                match event {
                    Event::Delta(_) => streamed = true,
                    Event::Subagent(ref started) => {
                        if let Some(id) = serde_json::from_str::<serde_json::Value>(started)
                            .ok()
                            .and_then(|value| value["id"].as_str().map(str::to_string))
                        {
                            subagents.insert(id);
                        }
                    }
                    Event::SubagentDone(ref id) if !subagents.contains(id) => continue,
                    Event::Text(_) if streamed => {
                        streamed = false;

                        continue;
                    }
                    _ => {}
                }

                emit(event);
            }
        }
    }

    if let Some(responder) = responder {
        if let Ok(mut guard) = responder.lock() {
            guard.take();
        }
    }

    let _ = child.wait();
    emit(Event::Done(String::new()));
}

/// Asks the Claude CLI one question and returns its plain answer; Err carries the real reason (CLI missing, stderr, exit code).
pub fn ask_once(
    root: &Path,
    prompt: &str,
    environment: &[(&str, String)],
) -> Result<String, String> {
    let program = locate(Cli::Claude.program())
        .ok_or_else(|| "Không tìm thấy Claude CLI (`claude`) trên máy.".to_string())?;
    let mut child = Command::new(program)
        .arg("-p")
        .current_dir(root)
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Không chạy được Claude CLI: {error}"))?;

    child
        .stdin
        .take()
        .ok_or_else(|| "Không mở được stdin của Claude CLI.".to_string())?
        .write_all(prompt.as_bytes())
        .map_err(|error| format!("Không gửi được câu hỏi tới Claude CLI: {error}"))?;

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Claude CLI dừng bất thường: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if output.status.success() {
        return if stdout.is_empty() {
            Err("Claude CLI chạy xong nhưng không trả về nội dung.".to_string())
        } else {
            Ok(stdout)
        };
    }

    // * Auth failures are often printed on stdout, other errors on stderr: show whichever has text.
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = [stderr, stdout]
        .into_iter()
        .find(|text| !text.is_empty())
        .unwrap_or_else(|| "không có thông báo lỗi".to_string());

    Err(format!("Claude CLI lỗi ({}): {detail}", output.status))
}

/// Splits an answer into a commit title (its first line) and a description (the rest).
pub fn split_message(answer: &str) -> (String, String) {
    let clean = answer.trim().trim_matches('`').trim();
    let (title, rest) = clean.split_once('\n').unwrap_or((clean, ""));

    (
        title.trim().trim_matches('"').to_string(),
        rest.trim().to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejected_rate_limit_becomes_a_limit_error() {
        let rejected = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}}"#;
        let allowed = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#;

        let events = parse_line(Cli::Claude, rejected);

        assert!(matches!(
            events.as_slice(),
            [Event::Error(message)] if crate::usage::is_limit_error(message)
        ));
        assert!(parse_line(Cli::Claude, allowed).is_empty());
    }

    #[test]
    fn ask_mode_has_the_cli_ask_this_app_and_a_tool_question_becomes_an_event() {
        let args = Cli::Claude.args(None, None, Some(ASK_MODE));
        let line = r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Write","description":"a.txt","input":{"file_path":"/a.txt"}}}"#;

        assert!(args.contains(&"--permission-prompt-tool".to_string()));
        assert!(!Cli::Claude
            .args(None, None, Some("auto"))
            .contains(&"--permission-prompt-tool".to_string()));
        assert!(matches!(
            parse_line(Cli::Claude, line).as_slice(),
            [Event::Permission(json)] if json.contains(r#""id":"r1""#) && json.contains(r#""tool":"Write""#)
        ));
        assert!(is_result_line(r#"{"type":"result","result":"x"}"#));
        assert!(!is_result_line(r#"{"type":"assistant","text":"result"}"#));
    }

    #[test]
    fn extra_projects_become_add_dir_flags() {
        let dirs = vec!["/a".to_string(), "/b".to_string()];
        let claude = with_add_dirs(Cli::Claude, Cli::Claude.args(None, None, None), &dirs);

        assert_eq!(
            claude[claude.len() - 4..],
            ["--add-dir", "/a", "--add-dir", "/b"]
        );

        let codex = with_add_dirs(Cli::Codex, Cli::Codex.args(Some("s"), None, None), &dirs);

        assert_eq!(
            codex[..6],
            ["exec", "--add-dir", "/a", "--add-dir", "/b", "resume"]
        );
        assert_eq!(
            with_add_dirs(Cli::Claude, Cli::Claude.args(None, None, None), &[]),
            Cli::Claude.args(None, None, None)
        );
    }

    #[test]
    fn claude_init_gives_session_and_assistant_gives_text() {
        let init = r#"{"type":"system","subtype":"init","session_id":"abc"}"#;
        let reply = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}"#;

        assert_eq!(
            parse_line(Cli::Claude, init),
            vec![Event::Session("abc".into())]
        );
        assert_eq!(
            parse_line(Cli::Claude, reply),
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
            parse_line(Cli::Claude, delta),
            vec![Event::Delta("Hel".into())]
        );
        assert!(parse_line(Cli::Claude, other).is_empty());
    }

    #[test]
    fn claude_tool_call_and_its_result_become_steps() {
        let call = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"b1","name":"Bash","input":{"command":"git status","description":"Show status"}}]}}"#;
        let done = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"b1","content":"clean","is_error":false}]}}"#;
        let failed = r#"{"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"b2","content":[{"type":"text","text":"boom"}],"is_error":true}]}}"#;

        let started = parse_line(Cli::Claude, call);

        assert_eq!(started.len(), 1);
        assert_eq!(
            payload(&started[0]),
            serde_json::json!({"id": "b1", "name": "Bash", "description": "Show status", "input": "git status"})
        );

        let finished = parse_line(Cli::Claude, done);

        assert_eq!(
            payload(&finished[0]),
            serde_json::json!({"id": "b1", "output": "clean", "error": false})
        );
        assert_eq!(finished[1], Event::SubagentDone("b1".into()));
        assert_eq!(
            payload(&parse_line(Cli::Claude, failed)[0]),
            serde_json::json!({"id": "b2", "output": "boom", "error": true})
        );
    }

    #[test]
    fn claude_file_edit_carries_the_text_before_and_after() {
        let edit = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"e1","name":"Edit","input":{"file_path":"a.rs","old_string":"x","new_string":"y"}}]}}"#;
        let write = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"w1","name":"Write","input":{"file_path":"b.rs","content":"new"}}]}}"#;

        let edited = payload(&parse_line(Cli::Claude, edit)[0]);
        let written = payload(&parse_line(Cli::Claude, write)[0]);

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
    fn claude_task_call_starts_a_subagent_and_its_result_ends_it() {
        let start = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","id":"t1","name":"Task","input":{"subagent_type":"reviewer","description":"Check the diff"}}]}}"#;
        let inner = r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"ls"}}]}}"#;
        let inner_result = r#"{"type":"user","parent_tool_use_id":"t1","message":{"content":[{"type":"tool_result","tool_use_id":"t2"}]}}"#;
        let started = parse_line(Cli::Claude, start);

        assert_eq!(started.len(), 2);
        assert_eq!(payload(&started[0])["name"], "Task");
        assert_eq!(
            payload(&started[1]),
            serde_json::json!({"id": "t1", "label": "reviewer: Check the diff"})
        );
        // * What happens inside a sub-agent is a step of that sub-agent (it names its parent), not of the main agent, and does not end it.
        let inner_call = parse_line(Cli::Claude, inner);
        let inner_done = parse_line(Cli::Claude, inner_result);

        assert_eq!(payload(&inner_call[0])["parent"], "t1");
        assert_eq!(inner_done.len(), 1);
        assert_eq!(payload(&inner_done[0])["parent"], "t1");
    }

    #[test]
    fn claude_sub_agent_words_stay_out_of_the_answer() {
        let words = r#"{"type":"assistant","parent_tool_use_id":"t1","message":{"content":[{"type":"text","text":"working"}]}}"#;
        let delta = r#"{"type":"stream_event","parent_tool_use_id":"t1","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"wor"}}}"#;
        let spoken = parse_line(Cli::Claude, words);

        assert_eq!(
            payload(&spoken[0]),
            serde_json::json!({"parent": "t1", "text": "working"})
        );
        assert!(parse_line(Cli::Claude, delta).is_empty());
    }

    #[test]
    fn claude_error_result_gives_error() {
        let line = r#"{"type":"result","is_error":true,"result":"boom"}"#;

        assert_eq!(
            parse_line(Cli::Claude, line),
            vec![Event::Error("boom".into())]
        );
    }

    #[test]
    fn codex_lines_map_to_events() {
        let thread = r#"{"type":"thread.started","thread_id":"t1"}"#;
        let message = r#"{"type":"item.completed","item":{"type":"agent_message","text":"Hi"}}"#;
        let notice = r#"{"type":"item.completed","item":{"type":"error","message":"noise"}}"#;
        let failed = r#"{"type":"turn.failed","error":{"message":"bad model"}}"#;

        assert_eq!(
            parse_line(Cli::Codex, thread),
            vec![Event::Session("t1".into())]
        );
        assert_eq!(
            parse_line(Cli::Codex, message),
            vec![Event::Text("Hi".into())]
        );
        assert!(parse_line(Cli::Codex, notice).is_empty());
        assert_eq!(
            parse_line(Cli::Codex, failed),
            vec![Event::Error("bad model".into())]
        );
    }

    #[test]
    fn answer_splits_into_title_and_description() {
        assert_eq!(
            split_message("Fix login\n\nBody line\nmore"),
            ("Fix login".to_string(), "Body line\nmore".to_string())
        );
        assert_eq!(
            split_message("Only title"),
            ("Only title".to_string(), String::new())
        );
    }

    #[test]
    fn lines_that_are_not_json_are_ignored() {
        assert!(parse_line(Cli::Claude, "not json").is_empty());
    }

    #[test]
    fn resume_arguments_differ_per_cli() {
        assert!(Cli::Claude
            .args(Some("s"), None, None)
            .ends_with(&["--resume".into(), "s".into()]));
        assert_eq!(
            Cli::Codex.args(Some("s"), None, None)[..3],
            ["exec".to_string(), "resume".to_string(), "s".to_string()]
        );
        assert_eq!(
            Cli::Codex.args(None, None, None).last().map(String::as_str),
            Some("-")
        );
    }

    #[test]
    fn model_goes_to_the_flag_of_each_cli() {
        assert!(Cli::Claude
            .args(None, Some("opus"), None)
            .ends_with(&["--model".into(), "opus".into()]));
        assert_eq!(
            Cli::Codex.args(Some("s"), Some("gpt-5"), None)[..5],
            [
                "exec".to_string(),
                "-m".to_string(),
                "gpt-5".to_string(),
                "resume".to_string(),
                "s".to_string()
            ]
        );
    }

    #[test]
    fn permission_mode_is_a_claude_flag_only() {
        let claude = Cli::Claude.args(None, None, Some("plan"));

        assert!(claude
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "plan"]));
        assert!(!Cli::Codex
            .args(None, None, Some("plan"))
            .iter()
            .any(|arg| arg == "--permission-mode"));
        assert!(valid_mode("acceptEdits"));
        assert!(!valid_mode("bypassPermissions"));
        assert!(!valid_mode("--x"));
    }

    #[test]
    fn model_names_cannot_become_flags() {
        assert!(valid_model("claude-opus-4.1"));
        assert!(valid_model("gpt-5-codex"));
        assert!(!valid_model("--dangerous"));
        assert!(!valid_model("a b"));
        assert!(!valid_model(""));
    }

    #[test]
    fn unknown_cli_name_is_rejected() {
        assert_eq!(Cli::parse("claude"), Some(Cli::Claude));
        assert_eq!(Cli::parse("rm"), None);
    }
}
