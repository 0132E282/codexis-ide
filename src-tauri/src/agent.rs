//! Chat with an AI CLI (`claude`, `codex` or `agy`): one turn runs the CLI non-interactively in the workspace folder and its JSON lines are turned into events for the chat.
//! The CLIs keep their default permissions, so a turn can read the project but cannot write to it unasked.
//! What differs per CLI (arguments, output lines) is behind [`AgentCli`], implemented in `claude.rs` and `codex.rs`.

mod antigravity;
mod claude;
mod claude_background;
mod codex;

pub use antigravity::AntigravityAgent;
pub use claude::ClaudeAgent;
pub use codex::CodexAgent;

use crate::background::BackgroundChange;
use crate::cli::{self, CliKind, Environment};
use crate::validation;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Write;
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Arc, Mutex};

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
    /// The CLI asks whether it may use a tool, as JSON `{"id", "tool", "description", "input"}`; answered with [`Responder::answer`].
    Permission(String),
    Error(String),
    /// The context level after a turn, as the JSON of [`crate::context::ContextUsage`].
    Context(String),
    /// A plan the agent wrote (not from a sub-agent), as the JSON of [`crate::plans::types::Plan`]; sent right after the `Tool` event of the same call.
    Plan(String),
    /// The background tasks of the project changed: JSON `{"tasks": [...]}` of [`crate::background::BackgroundTasks::snapshot_json`].
    Background(String),
    /// The AI that speaks from now on in a relayed turn (`claude`, `codex`): the chat shows it as a label before that AI's steps.
    Speaker(String),
    /// The main agent finished writing its answer (its message ended the turn), though the CLI may print the `Result` only after the background sub-agents are done. The chat treats the main agent as free from here while it keeps listening.
    Idle(String),
    /// The CLI printed the final result of the turn: the answer is complete, even if the process lingers (sub-agents, background tasks). The chat ends the turn here and ignores the `Done` that follows.
    Result(String),
    /// The CLI exited; always the last event of a turn.
    Done(String),
}

/// The options of one turn that depend on the person's choices.
#[derive(Debug, Clone, Copy)]
pub struct TurnOptions<'a> {
    /// The conversation to continue.
    pub session: Option<&'a str>,
    pub model: Option<&'a str>,
    /// Permission mode (Claude only).
    pub mode: Option<&'a str>,
    /// More project folders the CLI may work in, next to the one it runs in.
    pub add_dirs: &'a [String],
    /// Resume `session` into a new session id (Claude only: `--fork-session`), so a turn started while another one still runs on the same session does not write into its file.
    pub fork: bool,
}

impl TurnOptions<'_> {
    /// # Errors
    /// The error key of the first invalid option: the model is checked before the mode, then the session
    /// (`validation.bad_session`: it goes straight after `--resume` / `resume`, so it must never be read as a flag).
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.model.is_some_and(|name| !valid_model(name)) {
            return Err("agent.model_invalid");
        }

        if self.mode.is_some_and(|name| !valid_mode(name)) {
            return Err("agent.mode_invalid");
        }

        if self
            .session
            .is_some_and(|session| validation::valid_session(session).is_err())
        {
            return Err(validation::KEY_BAD_SESSION);
        }

        Ok(())
    }
}

/// An AI CLI that can run a chat turn: the only place that knows its arguments and its output format.
pub trait AgentCli: Sync {
    fn kind(&self) -> CliKind;

    /// Arguments of one turn; the prompt itself goes through stdin, so it can never be read as a flag.
    fn turn_args(&self, options: &TurnOptions<'_>) -> Vec<String>;

    /// The prompt as arguments, for a CLI that cannot read it from stdin; empty keeps the default (stdin).
    fn prompt_args(&self, _prompt: &str) -> Vec<String> {
        Vec::new()
    }

    /// Events carried by one output line of the CLI (empty for lines the chat does not show).
    fn parse_line(&self, line: &str) -> Vec<Event>;

    /// What one output line says about shell commands the CLI runs in the background (nothing for CLIs that say nothing).
    fn background_change(&self, _line: &str) -> Option<BackgroundChange> {
        None
    }

    /// Whether the CLI can ask this app before each tool use ([`ASK_MODE`]).
    fn supports_ask_mode(&self) -> bool {
        false
    }

    /// The environment of a turn, given the saved API keys; only some CLIs read them.
    fn turn_environment(&self, _api_keys: Environment, _agent_team: bool) -> Environment {
        Vec::new()
    }
}

static CLAUDE: ClaudeAgent = ClaudeAgent;
static CODEX: CodexAgent = CodexAgent;
static ANTIGRAVITY: AntigravityAgent = AntigravityAgent;

impl CliKind {
    /// The chat adapter of the CLI; none for the CLIs that cannot chat.
    pub fn agent(self) -> Option<&'static dyn AgentCli> {
        match self {
            Self::Claude => Some(&CLAUDE),
            Self::Codex => Some(&CODEX),
            Self::Antigravity => Some(&ANTIGRAVITY),
            Self::Gemini | Self::Github => None,
        }
    }
}

/// The text of a JSON string value, if it is not empty.
fn text(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|value| value.as_str())
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// A model name for `--model` / `-m`: letters, digits and `. _ : -`, never starting with `-`, so it cannot be read as another flag.
fn valid_model(model: &str) -> bool {
    validation::valid_model(model).is_ok()
}

/// The permission mode in which every tool use is asked of the person.
pub const ASK_MODE: &str = "manual";

/// The plan mode of the chat: the CLI runs it like [`ASK_MODE`] (input and permission questions through this app), so it can present its plan with `ExitPlanMode` `[đã kiểm: claude 2.1.319]`.
pub const PLAN_MODE: &str = "plan";

/// Plan mode that never asks: the CLI cannot leave it, so it stays read-only. For runs that cannot answer questions (the side chat).
pub const READ_ONLY_PLAN_MODE: &str = "planReadOnly";

/// Prefix of the run ids of the side chat, which has no card for permission questions.
pub const SIDE_RUN_PREFIX: &str = "side-";

/// Whether a turn in `mode` talks to the CLI through its input: the CLI's permission questions arrive here and are answered by the person.
pub fn asks_person(mode: Option<&str>) -> bool {
    matches!(mode, Some(ASK_MODE | PLAN_MODE))
}

/// The mode a run really uses: a side-chat run (`side-` run id) in plan mode gets [`READ_ONLY_PLAN_MODE`], since nobody answers its `ExitPlanMode` and approving it would leave plan mode and allow writes.
pub fn mode_for_run<'a>(run_id: &str, mode: Option<&'a str>) -> Option<&'a str> {
    match mode {
        Some(PLAN_MODE) if run_id.starts_with(SIDE_RUN_PREFIX) => Some(READ_ONLY_PLAN_MODE),
        other => other,
    }
}

/// Permission modes of the Claude CLI the chat offers (`--permission-mode`).
const MODES: [&str; 6] = [
    "plan",
    READ_ONLY_PLAN_MODE,
    "auto",
    "acceptEdits",
    "manual",
    "bypassPermissions",
];

/// Whether `mode` is one of the permission modes the chat offers.
fn valid_mode(mode: &str) -> bool {
    MODES.contains(&mode)
}

/// The person's answer to a permission question of the CLI.
#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// The tool may run with `input`.
    Allow {
        input: serde_json::Value,
    },
    Deny,
}

/// The input of a running CLI that waits for answers to its permission questions; closed when the turn's result arrives, which lets the CLI exit. It only writes while the turn is open.
#[derive(Clone, Default)]
pub struct Responder(Arc<Mutex<Option<ChildStdin>>>, Arc<Mutex<HashSet<String>>>);

impl Responder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Hands the CLI's input over, so answers can be written to it.
    fn attach(&self, stdin: ChildStdin) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(stdin);
        }
    }

    /// Remembers a permission question the CLI asked, so only a real one can be answered (once).
    fn expect(&self, request_id: &str) {
        if let Ok(mut pending) = self.1.lock() {
            pending.insert(request_id.to_string());
        }
    }

    /// Ends the answering; dropping the input is what lets the CLI exit.
    fn close(&self) {
        if let Ok(mut guard) = self.0.lock() {
            guard.take();
        }
    }

    /// Asks the CLI to stop one background task (`stop_task` control request); no model call is made.
    ///
    /// # Errors
    /// Fails when the turn has already ended (the input is closed) or the CLI no longer reads its input.
    pub fn stop_task(&self, task_id: &str) -> Result<(), String> {
        let line = serde_json::json!({
            "type": "control_request",
            "request_id": format!("stop-{task_id}"),
            "request": {"subtype": "stop_task", "task_id": task_id},
        });
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "agent.reply_failed".to_string())?;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "agent.turn_ended".to_string())?;

        writeln!(stdin, "{line}")
            .and_then(|()| stdin.flush())
            .map_err(|_| "agent.reply_failed".to_string())
    }

    /// Answers one permission question of the CLI.
    ///
    /// # Errors
    /// Fails when the turn has already ended or the CLI no longer reads its input.
    pub fn answer(&self, request_id: &str, decision: &Decision) -> Result<(), String> {
        let decision = match decision {
            Decision::Allow { input } => {
                serde_json::json!({"behavior": "allow", "updatedInput": input})
            }
            Decision::Deny => {
                serde_json::json!({"behavior": "deny", "message": "The user denied this."})
            }
        };
        let line = serde_json::json!({
            "type": "control_response",
            "response": {"subtype": "success", "request_id": request_id, "response": decision},
        });
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "agent.reply_failed".to_string())?;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "agent.turn_ended".to_string())?;

        // * Only a question the CLI asked, and only once: the id leaves the set as it is answered.
        let known = self
            .1
            .lock()
            .map_err(|_| "agent.reply_failed".to_string())?
            .remove(request_id);

        if !known {
            return Err(validation::KEY_REQUEST_UNKNOWN.to_string());
        }

        writeln!(stdin, "{line}")
            .and_then(|()| stdin.flush())
            .map_err(|_| "agent.reply_failed".to_string())
    }
}

/// Whether a line of the CLI's output is the final result of the turn.
fn is_result_line(line: &str) -> bool {
    line.contains("\"result\"")
        && serde_json::from_str::<serde_json::Value>(line)
            .is_ok_and(|value| value["type"] == "result")
}

/// The `id` of a `Permission` event's JSON.
fn permission_id(json: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()?
        .get("id")?
        .as_str()
        .map(str::to_string)
}

/// The receiver of what happens during a turn.
pub trait TurnObserver {
    /// The CLI process started.
    fn spawned(&self, pid: u32);

    fn event(&self, event: Event);

    /// What the CLI reported about a background shell command; nothing by default.
    fn background(&self, _change: &BackgroundChange) {}
}

/// Drops the events the chat must not show twice or without context.
#[derive(Default)]
struct EventFilter {
    /// The complete text message that follows its own deltas would show the same words twice; without deltas (an old CLI) it is the only source.
    streamed: bool,
    /// Ids of the sub-agents started in this turn: only their results are reported as "done".
    subagents: HashSet<String>,
}

impl EventFilter {
    fn admit(&mut self, event: &Event) -> bool {
        match event {
            Event::Delta(_) => self.streamed = true,
            Event::Subagent(started) => {
                if let Some(id) = serde_json::from_str::<serde_json::Value>(started)
                    .ok()
                    .and_then(|value| value["id"].as_str().map(str::to_string))
                {
                    self.subagents.insert(id);
                }
            }
            Event::SubagentDone(id) if !self.subagents.contains(id) => return false,
            Event::Text(_) if self.streamed => {
                self.streamed = false;

                return false;
            }
            _ => {}
        }

        true
    }
}

/// The language rule of the chat for the interface language (`vi`, `en`); none while the language is not chosen.
fn language_rule(language: &str) -> Option<&'static str> {
    match language {
        "vi" => Some("Always answer in Vietnamese, even when the user writes in another language."),
        "en" => Some("Always answer in English, even when the user writes in another language."),
        _ => None,
    }
}

/// The prompt with the language rule in front, so the answer follows the language setting whatever the person typed.
fn with_language(prompt: &str, language: &str) -> String {
    match language_rule(language) {
        Some(rule) => format!("[{rule}]\n\n{prompt}"),
        None => prompt.to_string(),
    }
}

/// One chat turn: everything needed to run `cli` once in `root`.
pub struct TurnRequest<'a> {
    pub cli: &'static dyn AgentCli,
    pub root: &'a Path,
    pub prompt: &'a str,
    pub options: TurnOptions<'a>,
    pub language: &'a str,
    pub environment: &'a [(&'static str, String)],
    /// Set when the CLI asks the person before each tool use.
    pub responder: Option<&'a Responder>,
}

impl TurnRequest<'_> {
    /// Runs the turn and reports to `observer`; the last event is always `Event::Done`.
    pub fn run(&self, observer: &dyn TurnObserver) {
        let mut child = match self.spawn() {
            Ok(child) => child,
            Err(message) => {
                observer.event(Event::Error(message));
                observer.event(Event::Done(String::new()));

                return;
            }
        };

        observer.spawned(child.id());

        if let Some(stdin) = child.stdin.take() {
            self.send_prompt(stdin);
        }

        if let Some(stdout) = child.stdout.take() {
            self.stream(stdout, observer);
        }

        if let Some(responder) = self.responder {
            responder.close();
        }

        let _ = child.wait();
        observer.event(Event::Done(String::new()));
    }

    fn spawn(&self) -> Result<Child, String> {
        let program = self.cli.kind().program();
        let path =
            cli::locate(program).ok_or_else(|| format!("agent.command_missing|{program}"))?;

        cli::command(&path, self.environment)
            .args(self.cli.turn_args(&self.options))
            .args(
                self.cli
                    .prompt_args(&with_language(self.prompt, self.language)),
            )
            .current_dir(self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| format!("agent.command_failed|{program}"))
    }

    fn send_prompt(&self, mut stdin: ChildStdin) {
        let prompt = with_language(self.prompt, self.language);

        // * The CLI already got the prompt as arguments: stdin is dropped (closed) at once.
        if !self.cli.prompt_args("").is_empty() {
            return;
        }

        match self.responder {
            // * The input stays open: the CLI's permission questions are answered on it until the turn's result.
            Some(responder) => {
                let message = serde_json::json!({
                    "type": "user",
                    "message": {"role": "user", "content": prompt},
                });
                let _ = writeln!(stdin, "{message}").and_then(|()| stdin.flush());

                responder.attach(stdin);
            }
            // Dropping stdin at the end of this block closes it, which is what tells the CLI the prompt is complete.
            None => {
                let _ = stdin.write_all(prompt.as_bytes());
            }
        }
    }

    fn stream(&self, stdout: ChildStdout, observer: &dyn TurnObserver) {
        let mut filter = EventFilter::default();
        let mut reader = std::io::BufReader::new(stdout);
        // * One buffer for every line of the turn (`BufRead::lines` allocates a `String` per line).
        let mut buffer = String::new();

        loop {
            buffer.clear();

            if !matches!(std::io::BufRead::read_line(&mut reader, &mut buffer), Ok(read) if read > 0)
            {
                break;
            }

            // * The line ending goes like `BufRead::lines` removes it: `\n`, then a `\r` before it.
            let line = buffer.strip_suffix('\n').unwrap_or(&buffer);
            let line = line.strip_suffix('\r').unwrap_or(line);

            let is_result = is_result_line(line);

            if let (true, Some(responder)) = (is_result, self.responder) {
                responder.close();
            }

            if let Some(change) = self.cli.background_change(line) {
                observer.background(&change);
            }

            for event in self.cli.parse_line(line) {
                if filter.admit(&event) {
                    // * Remembered before the chat is told, so its answer cannot arrive first.
                    if let (Some(responder), Event::Permission(json)) = (self.responder, &event) {
                        if let Some(id) = permission_id(json) {
                            responder.expect(&id);
                        }
                    }

                    observer.event(event);
                }
            }

            // * After the result's own events (error, context), so the chat has them all before it ends the turn.
            if is_result {
                observer.event(Event::Result(String::new()));
            }
        }
    }
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
#[path = "../tests/unit/agent.rs"]
mod tests;
