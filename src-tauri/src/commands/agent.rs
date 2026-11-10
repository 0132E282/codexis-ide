use super::background::{BackgroundStore, ProjectTasks};
use super::plan::project_data_dir;
use super::state::AppState;
use crate::activity;
use crate::agent::{self, AgentCli, Decision, Responder, TurnObserver, TurnOptions, TurnRequest};
use crate::background::{BackgroundChange, TaskKind};
use crate::cli::CliKind;
use crate::credentials::CredentialStore;
use crate::git;
use crate::plans::store::PlanStore;
use crate::plans::types::Plan;
use crate::profiles::ProfileStore;
use crate::relay::{self, HopRunner, RelayStop};
use crate::run_log::{LogEntry, RunLog};
use crate::settings::SettingsStore;
use crate::validation;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// What the app keeps of a running turn.
struct RunHandle {
    /// Set while the CLI waits for answers to its permission questions.
    responder: Option<Responder>,
    /// Process id of the turn's CLI, so the turn can be stopped; known once it started.
    pid: Option<u32>,
    /// The person asked to stop: a relayed turn starts no further hop.
    stopped: bool,
}

/// The running turns by run id: where their permission questions are answered and which process stops them.
#[derive(Default)]
pub struct TurnRegistry(Mutex<HashMap<String, RunHandle>>);

impl TurnRegistry {
    /// # Errors
    /// `validation.run_exists` when a turn with this id is still running (it would lose its process id), `agent.reply_failed` when the registry is poisoned.
    fn start(&self, run_id: &str, responder: Option<Responder>) -> Result<(), String> {
        let mut runs = self
            .0
            .lock()
            .map_err(|_| "agent.reply_failed".to_string())?;

        if runs.contains_key(run_id) {
            return Err(validation::KEY_RUN_EXISTS.to_string());
        }

        runs.insert(
            run_id.to_string(),
            RunHandle {
                responder,
                pid: None,
                stopped: false,
            },
        );

        Ok(())
    }

    /// Remembers the process of the turn; returns whether the person already asked to stop (the process must then end at once).
    fn set_pid(&self, run_id: &str, pid: u32) -> bool {
        let Ok(mut runs) = self.0.lock() else {
            return false;
        };

        runs.get_mut(run_id).is_some_and(|run| {
            run.pid = Some(pid);
            run.stopped
        })
    }

    /// The CLI process of a hop ended: its id must not be used to stop anything later.
    fn clear_pid(&self, run_id: &str) {
        if let Ok(mut runs) = self.0.lock() {
            if let Some(run) = runs.get_mut(run_id) {
                run.pid = None;
            }
        }
    }

    /// Whether the person asked to stop this turn.
    fn is_stopped(&self, run_id: &str) -> bool {
        self.0
            .lock()
            .is_ok_and(|runs| runs.get(run_id).is_some_and(|run| run.stopped))
    }

    /// Marks the turn as stopped (no more relay hops) and gives the process to end, if one runs now.
    ///
    /// # Errors
    /// `agent.stop_failed` when the registry is poisoned, `agent.turn_ended` when the turn is gone.
    fn request_stop(&self, run_id: &str) -> Result<Option<u32>, String> {
        let mut runs = self.0.lock().map_err(|_| "agent.stop_failed".to_string())?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| "agent.turn_ended".to_string())?;

        run.stopped = true;

        Ok(run.pid)
    }

    fn finish(&self, run_id: &str) {
        if let Ok(mut runs) = self.0.lock() {
            runs.remove(run_id);
        }
    }

    /// Ends the process of every running turn (the app is closing).
    pub fn stop_all(&self) {
        let pids: Vec<u32> = self
            .0
            .lock()
            .map(|runs| runs.values().filter_map(|run| run.pid).collect())
            .unwrap_or_default();

        for pid in pids {
            let _ = kill(pid);
        }
    }

    /// # Errors
    /// `agent.reply_failed` when the registry is poisoned, `agent.turn_ended` when the turn is gone or asks nothing.
    pub(super) fn responder(&self, run_id: &str) -> Result<Responder, String> {
        self.0
            .lock()
            .map_err(|_| "agent.reply_failed".to_string())?
            .get(run_id)
            .and_then(|run| run.responder.clone())
            .ok_or_else(|| "agent.turn_ended".to_string())
    }

    /// # Errors
    /// `agent.stop_failed` when the registry is poisoned, `agent.turn_ended` when the turn is gone or has no process yet.
    pub(super) fn pid(&self, run_id: &str) -> Result<u32, String> {
        self.0
            .lock()
            .map_err(|_| "agent.stop_failed".to_string())?
            .get(run_id)
            .and_then(|run| run.pid)
            .ok_or_else(|| "agent.turn_ended".to_string())
    }
}

/// Ends the process `pid` (and, on Windows, its children).
pub(super) fn kill(pid: u32) -> Result<(), String> {
    let pid = pid.to_string();
    let status = if cfg!(windows) {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .status()
    } else {
        std::process::Command::new("kill").arg(&pid).status()
    };

    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err("agent.stop_failed".to_string()),
    }
}

/// Tells the chat about a turn as `agent-event` events and keeps the turn's process id in the registry; also keeps the plan the AI writes and a log of the turn in the project's folder in the app's data (a failure there never breaks the turn).
struct TauriTurnObserver {
    app: AppHandle,
    run_id: String,
    plans: Option<PlanStore>,
    log: Option<RunLog>,
    /// The CLI session the turn runs in: the one it continues, replaced by the one the CLI reports.
    session: Mutex<Option<String>>,
    /// The project's background tasks, saved whenever they change.
    background: Arc<ProjectTasks>,
    /// The project and where the CLI works (a worktree copy of it, maybe): to turn the path of an edit into a path of the project, and to keep the plan in the project when the person allows it.
    project: ObservedProject,
    /// Edit tool calls waiting for their result: tool id and the path they change. The event is stored only when the call succeeded.
    pending_edits: Mutex<HashMap<String, String>>,
}

struct ObservedProject {
    root: PathBuf,
    work_root: PathBuf,
    name: String,
    id: String,
}

/// Most edit calls waiting for a result at once; more are not tracked.
const MAX_PENDING_EDITS: usize = 256;

impl TauriTurnObserver {
    fn log(&self, entry: &LogEntry<'_>) {
        if let Some(log) = &self.log {
            log.record(entry);
        }
    }

    fn keep_plan(&self, json: &str) {
        let (Some(plans), Ok(session)) = (&self.plans, self.session.lock()) else {
            return;
        };
        let (Some(session), Ok(plan)) = (session.as_deref(), serde_json::from_str::<Plan>(json))
        else {
            return;
        };

        let is_text = matches!(plan, Plan::Text { .. });
        let session = session.to_string();

        if plans.record(&session, plan).is_ok() && is_text {
            super::activity::auto_save_plan(
                &self.app,
                &self.project.root,
                &self.project.name,
                &self.project.id,
                &session,
            );
        }
    }

    /// Remembers an edit tool call (path only, never what it writes) until its result says it worked.
    fn track_edit(&self, value: &serde_json::Value) {
        let (Some(name), Some(id)) = (value["name"].as_str(), value["id"].as_str()) else {
            return;
        };
        let roots = [
            self.project.work_root.as_path(),
            self.project.root.as_path(),
        ];
        let Some(path) = activity::ai_edit_path(name, &value["input"], &roots) else {
            return;
        };

        if let Ok(mut pending) = self.pending_edits.lock() {
            if pending.len() < MAX_PENDING_EDITS {
                pending.insert(id.to_string(), path);
            }
        }
    }

    fn has_pending_edits(&self) -> bool {
        self.pending_edits
            .lock()
            .is_ok_and(|pending| !pending.is_empty())
    }

    /// Stores the `ai_edit` event of a tracked edit whose result was not an error.
    fn finish_edit(&self, value: &serde_json::Value) {
        let Some(id) = value["id"].as_str() else {
            return;
        };
        let path = self
            .pending_edits
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id));

        if let (Some(path), false) = (path, value["error"] == true) {
            super::activity::log_file_event(
                &self.app,
                &activity::NewFileEvent::ai_edit(&self.project.root.display().to_string(), &path),
            );
        }
    }

    /// Keeps the pictures a tool returned (screenshots the AI took, for one) with the project's documents. A failure is reported as the `chat-image-store-failed` event and never breaks the turn.
    fn keep_images(&self, value: &serde_json::Value) {
        let Some(store) = self.app.try_state::<activity::ActivityStore>() else {
            return;
        };
        let root = self.project.root.display().to_string();

        for url in value["images"].as_array().into_iter().flatten() {
            let Some(bytes) = url.as_str().and_then(activity::base64_data_url_bytes) else {
                continue;
            };

            if let Err(error) = store.save_image(&root, None, "ai-image", &bytes) {
                let _ = self.app.emit(
                    super::activity::CHAT_IMAGE_STORE_FAILED,
                    serde_json::json!({ "error": error.to_string() }),
                );
            }
        }
    }

    /// Keeps what the persisted data needs from `event`: the session id, plans and log lines.
    fn persist(&self, event: &agent::Event) {
        match event {
            agent::Event::Session(id) => {
                if let Ok(mut session) = self.session.lock() {
                    *session = Some(id.clone());
                }
            }
            agent::Event::Plan(json) => self.keep_plan(json),
            agent::Event::Tool(json) => {
                let value = serde_json::from_str::<serde_json::Value>(json).unwrap_or_default();

                if let Some(name) = value["name"].as_str() {
                    self.log(&LogEntry::Tool(name));
                }

                self.track_edit(&value);
            }
            // * Parsed only while an edit call waits for its result or when it carries pictures: most results are neither, and their output can be 2000 characters.
            agent::Event::ToolResult(json) => {
                let has_images = json.contains("\"images\":[");

                if has_images || self.has_pending_edits() {
                    let value = serde_json::from_str(json).unwrap_or_default();

                    self.finish_edit(&value);

                    if has_images {
                        self.keep_images(&value);
                    }
                }
            }
            agent::Event::Error(message) => self.log(&LogEntry::Error(message)),
            agent::Event::Done(_) => self.log(&LogEntry::End),
            _ => {}
        }
    }
}

impl TauriTurnObserver {
    /// Saves the background tasks and tells the chat the table changed.
    fn announce_background(&self) {
        if let Err(message) = self.background.save() {
            eprintln!("background tasks not saved: {message}");
        }

        self.event(agent::Event::Background(
            self.background.table.snapshot_json(),
        ));
    }
}

impl TurnObserver for TauriTurnObserver {
    fn spawned(&self, pid: u32) {
        // * A stop that came before the process existed ends it now.
        if self.app.state::<TurnRegistry>().set_pid(&self.run_id, pid) {
            let _ = kill(pid);
        }
    }

    fn background(&self, change: &BackgroundChange) {
        if self.background.table.apply(change) {
            // * A task that ended is dropped at once: nothing finished is kept in the table.
            self.background.table.clear_finished();
            self.announce_background();
        }
    }

    fn event(&self, event: agent::Event) {
        self.persist(&event);

        // * A sub-agent is a background task too: its start adds a row and its result closes it.
        let changed = match &event {
            agent::Event::Subagent(started) => {
                let value: serde_json::Value = serde_json::from_str(started).unwrap_or_default();

                value["id"].as_str().is_some_and(|id| {
                    self.background.table.start(
                        id,
                        TaskKind::Subagent,
                        value["label"].as_str().unwrap_or_default(),
                    )
                })
            }
            // * A finished sub-agent leaves the table: only its final result stays, in the chat.
            agent::Event::SubagentDone(id) => self.background.table.remove(id),
            _ => false,
        };

        if changed {
            self.announce_background();
        }

        // * Borrowed, so the hot path allocates no copy of the run id per event.
        let _ = self.app.emit(
            "agent-event",
            AgentPayload {
                run_id: &self.run_id,
                event: &event,
            },
        );
    }
}

/// One event of a chat turn, tagged with the turn it belongs to.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct AgentPayload<'a> {
    run_id: &'a str,
    #[serde(flatten)]
    event: &'a agent::Event,
}

/// The folder a turn works in for `project`: the project itself, or in worktree mode its own branch and copy kept in the app's data folder, so the project stays untouched.
fn working_folder(
    app: &AppHandle,
    project: &Path,
    worktree: Option<&str>,
) -> Result<PathBuf, String> {
    let Some(name) = worktree else {
        return Ok(project.to_path_buf());
    };
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("worktrees")
        .join(&format!("{:x}", Sha256::digest(project.to_string_lossy().as_bytes()))[..12]);

    git::ensure_worktree(project, &base, name).map_err(|error| error.to_string())
}

/// The environment of a turn of `cli`: the saved API keys and the agent-team switch go only to the CLIs that read them, and the turn runs under the account chosen for this CLI.
fn turn_environment(
    app: &AppHandle,
    cli: &dyn AgentCli,
    agent_team: bool,
) -> Vec<(&'static str, String)> {
    let mut environment =
        cli.turn_environment(app.state::<CredentialStore>().environment(), agent_team);

    environment.extend(
        app.state::<ProfileStore>()
            .active_environment(cli.kind().name()),
    );

    environment
}

/// Passes a turn's events to the chat while a relay follows it: keeps the answer and the session the relay needs, holds back `Done` (the relay sends one when it ends) and, for an AI the chat is not talking to, also the session, context and plan (they belong to the chat's own AI).
struct HopObserver<'a> {
    chat: &'a TauriTurnObserver,
    /// The AI of the chat itself speaks.
    own: bool,
    answer: Mutex<String>,
    session: Mutex<Option<String>>,
    failed: AtomicBool,
}

impl<'a> HopObserver<'a> {
    fn new(chat: &'a TauriTurnObserver, own: bool) -> Self {
        Self {
            chat,
            own,
            answer: Mutex::new(String::new()),
            session: Mutex::new(None),
            failed: AtomicBool::new(false),
        }
    }

    fn keep_answer(&self, text: &str, separate: bool) {
        if let Ok(mut answer) = self.answer.lock() {
            if separate && !answer.is_empty() {
                answer.push_str("\n\n");
            }

            answer.push_str(text);
        }
    }

    fn answer(&self) -> String {
        self.answer
            .lock()
            .map(|answer| answer.clone())
            .unwrap_or_default()
    }

    fn session(&self) -> Option<String> {
        self.session.lock().ok().and_then(|session| session.clone())
    }

    fn failed(&self) -> bool {
        self.failed.load(Ordering::Relaxed)
    }
}

impl TurnObserver for HopObserver<'_> {
    fn spawned(&self, pid: u32) {
        self.chat.spawned(pid);
    }

    fn background(&self, change: &BackgroundChange) {
        self.chat.background(change);
    }

    fn event(&self, event: agent::Event) {
        match &event {
            agent::Event::Text(text) => self.keep_answer(text, true),
            agent::Event::Delta(text) => self.keep_answer(text, false),
            agent::Event::Session(id) => {
                if let Ok(mut session) = self.session.lock() {
                    *session = Some(id.clone());
                }
            }
            agent::Event::Error(_) => self.failed.store(true, Ordering::Relaxed),
            // * The relay ends the turn itself (its own `Done`), not at the result of one hop.
            agent::Event::Done(_) | agent::Event::Result(_) | agent::Event::Idle(_) => return,
            _ => {}
        }

        let foreign = matches!(
            event,
            agent::Event::Session(_) | agent::Event::Context(_) | agent::Event::Plan(_)
        );

        if self.own || !foreign {
            self.chat.event(event);
        }
    }
}

/// The permission mode of a relayed hop, which has nobody to answer questions: plan mode stays read-only and "ask each time" falls back to the CLI's default.
pub(crate) fn mode_for_hop(mode: Option<&str>) -> Option<&str> {
    match mode {
        Some(agent::PLAN_MODE) => Some(agent::READ_ONLY_PLAN_MODE),
        Some(agent::ASK_MODE) => None,
        other => other,
    }
}

/// Runs the hops of a relayed turn as real CLI turns of the same chat run.
struct TauriHopRunner<'a> {
    app: &'a AppHandle,
    chat: &'a TauriTurnObserver,
    run_id: &'a str,
    root: &'a Path,
    add_dirs: &'a [String],
    language: &'a str,
    agent_team: bool,
    /// The AI the chat talks to: it keeps its model and its chat session events.
    chat_cli: CliKind,
    model: Option<&'a str>,
    mode: Option<&'a str>,
    /// The session each AI has in this relay, so it remembers what it said in an earlier hop.
    sessions: HashMap<CliKind, String>,
}

impl HopRunner for TauriHopRunner<'_> {
    fn stopped(&self) -> bool {
        self.app.state::<TurnRegistry>().is_stopped(self.run_id)
    }

    fn run_hop(&mut self, target: CliKind, prompt: &str) -> Option<String> {
        let cli = target.agent()?;
        let own = target == self.chat_cli;
        let environment = turn_environment(self.app, cli, self.agent_team);
        let observer = HopObserver::new(self.chat, own);

        self.chat
            .event(agent::Event::Speaker(target.name().to_string()));

        TurnRequest {
            cli,
            root: self.root,
            prompt,
            options: TurnOptions {
                session: self.sessions.get(&target).map(String::as_str),
                model: if own { self.model } else { None },
                mode: mode_for_hop(self.mode),
                add_dirs: self.add_dirs,
                fork: false,
            },
            language: self.language,
            environment: &environment,
            responder: None,
        }
        .run(&observer);

        self.app.state::<TurnRegistry>().clear_pid(self.run_id);

        if let Some(session) = observer.session() {
            self.sessions.insert(target, session);
        }

        (!observer.failed() && !self.stopped()).then(|| observer.answer())
    }

    fn notice(&mut self, stop: RelayStop) {
        self.chat.event(agent::Event::Error(stop.key().to_string()));
    }
}

/// Starts one chat turn with `cli` in the open workspace and returns at once; the answer arrives as `agent-event` events tagged with `run_id`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn agent_send(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
    cli: String,
    prompt: String,
    session: Option<String>,
    model: Option<String>,
    mode: Option<String>,
    agent_team: bool,
    root: Option<String>,
    extra_roots: Option<Vec<String>>,
    worktree: Option<String>,
    fork: bool,
) -> Result<(), String> {
    let cli = CliKind::parse_agent(&cli)
        .and_then(CliKind::agent)
        .ok_or("agent.cli_unsupported")?;

    // * Chat turns are `run-…`, side-chat turns `side-…`; the prompt and the session (which may come from the saved history) are checked before anything starts.
    let prefix = if run_id.starts_with(agent::SIDE_RUN_PREFIX) {
        agent::SIDE_RUN_PREFIX
    } else {
        "run-"
    };

    validation::run_id(&run_id, prefix)?;
    validation::prompt(&prompt)?;

    TurnOptions {
        session: session.as_deref(),
        model: model.as_deref(),
        mode: mode.as_deref(),
        add_dirs: &[],
        fork,
    }
    .validate()?;

    let root = state.workspace_for(root.as_deref())?.root().to_path_buf();
    let project_root = root.clone();
    // * The plan and log of the turn belong to the project, not to the worktree copy the CLI may work in.
    let (project_name, project_id) = state.project_identity(&root);
    // * The background tasks of this project, and the turn that can stop them.
    let project_key = root.display().to_string();
    let background =
        app.state::<BackgroundStore>()
            .project(&project_key, &project_name, &project_id)?;
    // * More projects of the same chat: only saved projects are accepted, and the CLI may then also work in their folders.
    let extra_folders = extra_roots
        .unwrap_or_default()
        .iter()
        .map(|extra| Ok(state.workspace_for(Some(extra))?.root().to_path_buf()))
        .collect::<Result<Vec<_>, String>>()?;
    // * Creating a worktree runs git, so it happens on the blocking pool.
    let (root, add_dirs) = super::blocking("agent.workdir_failed", {
        let app = app.clone();

        move || {
            let add_dirs = extra_folders
                .iter()
                .map(|folder| {
                    working_folder(&app, folder, worktree.as_deref())
                        .map(|folder| folder.display().to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            let root = working_folder(&app, &root, worktree.as_deref())?;

            Ok((root, add_dirs))
        }
    })
    .await?;
    let environment = turn_environment(&app, cli, agent_team);

    // * Only "Hỏi từng việc" and plan mode of the Claude CLI ask the person: its input stays open for the answers. The side chat has nobody to answer, so its plan mode stays read-only and never asks.
    let mode = agent::mode_for_run(&run_id, mode.as_deref()).map(str::to_string);
    let responder =
        (cli.supports_ask_mode() && agent::asks_person(mode.as_deref())).then(Responder::new);

    app.state::<TurnRegistry>()
        .start(&run_id, responder.clone())?;
    app.state::<BackgroundStore>()
        .set_live_run(&project_key, Some(&run_id));

    // * The answer follows the language setting of the interface, whatever language the person types in.
    let language = app
        .state::<SettingsStore>()
        .get()
        .map(|settings| settings.language)
        .unwrap_or_default();

    std::thread::spawn(move || {
        let data_dir = project_data_dir(&app, &project_name, &project_id);
        let observer = TauriTurnObserver {
            app: app.clone(),
            run_id: run_id.clone(),
            plans: data_dir.clone().map(PlanStore::new),
            log: data_dir.map(|dir| RunLog::new(dir, &run_id, cli.kind().name())),
            session: Mutex::new(session.clone()),
            background: background.clone(),
            project: ObservedProject {
                root: project_root,
                work_root: root.clone(),
                name: project_name.clone(),
                id: project_id.clone(),
            },
            pending_edits: Mutex::new(HashMap::new()),
        };

        observer.log(&LogEntry::Start);

        let request = TurnRequest {
            cli,
            root: &root,
            prompt: &prompt,
            options: TurnOptions {
                session: session.as_deref(),
                model: model.as_deref(),
                mode: mode.as_deref(),
                add_dirs: &add_dirs,
                fork,
            },
            language: &language,
            environment: &environment,
            responder: responder.as_ref(),
        };

        // * The side chat talks to one AI; a chat turn may pass the word to the other AIs (`relay`) before it ends.
        if run_id.starts_with(agent::SIDE_RUN_PREFIX) {
            request.run(&observer);
        } else {
            let first = HopObserver::new(&observer, true);

            request.run(&first);

            if !first.failed() && !app.state::<TurnRegistry>().is_stopped(&run_id) {
                let mut sessions = HashMap::new();

                if let Some(session) = first.session().or(session.clone()) {
                    sessions.insert(cli.kind(), session);
                }

                relay::drive(
                    &mut TauriHopRunner {
                        app: &app,
                        chat: &observer,
                        run_id: &run_id,
                        root: &root,
                        add_dirs: &add_dirs,
                        language: &language,
                        agent_team,
                        chat_cli: cli.kind(),
                        model: model.as_deref(),
                        mode: mode.as_deref(),
                        sessions,
                    },
                    cli.kind(),
                    &prompt,
                    first.answer(),
                );
            }

            observer.event(agent::Event::Done(String::new()));
        }

        // * A sub-agent lives inside the CLI process, so none is still running when the turn ends.
        if background.table.stop_running_subagents() {
            background.table.clear_finished();
            observer.announce_background();
        }

        app.state::<BackgroundStore>()
            .set_live_run(&project_key, None);

        app.state::<TurnRegistry>().finish(&run_id);
    });

    Ok(())
}

/// Answers a permission question of a running turn: `allow` lets the tool run with `input`, otherwise it is denied.
#[tauri::command]
pub fn agent_permission(
    registry: State<'_, TurnRegistry>,
    run_id: String,
    request_id: String,
    allow: bool,
    input: serde_json::Value,
) -> Result<(), String> {
    validation::run_id(
        &run_id,
        if run_id.starts_with(agent::SIDE_RUN_PREFIX) {
            agent::SIDE_RUN_PREFIX
        } else {
            "run-"
        },
    )?;
    validation::request_id(&request_id)?;
    validation::permission_input(&input)?;

    let decision = if allow {
        Decision::Allow { input }
    } else {
        Decision::Deny
    };

    registry.responder(&run_id)?.answer(&request_id, &decision)
}

/// Stops a running turn (Ctrl+C in the chat): its CLI process is ended, which finishes the turn with what it had so far; a relay of several AIs stops as a whole.
#[tauri::command]
pub fn agent_stop(registry: State<'_, TurnRegistry>, run_id: String) -> Result<(), String> {
    // * Also ends a relayed turn: no further hop starts, even between two CLIs' processes.
    registry.request_stop(&run_id)?.map_or(Ok(()), kill)
}

#[cfg(test)]
#[path = "../../tests/unit/commands_agent.rs"]
mod tests;

/// The models an AI CLI lists for the account, from its own `/model` (`codex`: its model cache; `claude`: its answer to `/model`); empty when the CLI cannot say, so the front end shows its fixed list.
#[tauri::command]
pub async fn agent_models(
    app: AppHandle,
    cli: String,
) -> Result<Vec<crate::models::ModelOption>, String> {
    super::blocking("agent.models_failed", move || {
        Ok(match cli.as_str() {
            "codex" => crate::models::codex_home()
                .map(|home| crate::models::codex_models(&home))
                .unwrap_or_default(),
            "claude" => {
                let environment = app.state::<ProfileStore>().active_environment("claude");

                crate::cli::locate("claude")
                    .map(|program| crate::models::claude_models(&program, &environment))
                    .unwrap_or_default()
            }
            _ => Vec::new(),
        })
    })
    .await
}
