use super::state::AppState;
use crate::agent::{self, Cli};
use crate::credentials::CredentialStore;
use crate::git;
use crate::profiles::ProfileStore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// The running turns that wait for answers to the CLI's permission questions, by run id.
#[derive(Default)]
pub struct Approvals(Mutex<HashMap<String, agent::Responder>>);

/// Process ids of the running turns' CLIs, by run id, so a turn can be stopped.
#[derive(Default)]
pub struct Running(Mutex<HashMap<String, u32>>);

/// One event of a chat turn, tagged with the turn it belongs to.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentPayload {
    run_id: String,
    #[serde(flatten)]
    event: agent::Event,
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
) -> Result<(), String> {
    let cli = Cli::parse(&cli).ok_or("Chưa hỗ trợ CLI này.")?;

    if model
        .as_deref()
        .is_some_and(|name| !agent::valid_model(name))
    {
        return Err("Tên model không hợp lệ.".to_string());
    }

    if mode.as_deref().is_some_and(|name| !agent::valid_mode(name)) {
        return Err("Chế độ không hợp lệ.".to_string());
    }

    let root = state.workspace_for(root.as_deref())?.root().to_path_buf();
    // * More projects of the same chat: only saved projects are accepted, and the CLI may then also work in their folders.
    let extra_folders = extra_roots
        .unwrap_or_default()
        .iter()
        .map(|extra| Ok(state.workspace_for(Some(extra))?.root().to_path_buf()))
        .collect::<Result<Vec<_>, String>>()?;
    // * Creating a worktree runs git, so it happens on the blocking pool.
    let (root, add_dirs) =
        super::blocking("Không chuẩn bị được thư mục làm việc.", {
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
    // * Saved API keys go to the Claude CLI only; Codex has no key of its own here.
    let mut environment = if cli == Cli::Claude {
        app.state::<CredentialStore>().environment()
    } else {
        Vec::new()
    };

    // * Agent teams are an experimental feature of the Claude CLI, switched on through this variable.
    if agent_team && cli == Cli::Claude {
        environment.push(("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1".to_string()));
    }

    // * The chat runs under the account chosen for this CLI.
    environment.extend(app.state::<ProfileStore>().active_environment(cli.name()));

    // * Only "Hỏi từng việc" of the Claude CLI asks the person: its input stays open for the answers.
    let responder = (cli == Cli::Claude && mode.as_deref() == Some(agent::ASK_MODE))
        .then(|| Arc::new(Mutex::new(None)));

    if let Some(responder) = &responder {
        if let Ok(mut running) = app.state::<Approvals>().0.lock() {
            running.insert(run_id.clone(), Arc::clone(responder));
        }
    }

    std::thread::spawn(move || {
        agent::run_turn(
            cli,
            &root,
            &prompt,
            session.as_deref(),
            model.as_deref(),
            mode.as_deref(),
            &add_dirs,
            &environment,
            responder.as_ref(),
            |pid| {
                if let Ok(mut running) = app.state::<Running>().0.lock() {
                    running.insert(run_id.clone(), pid);
                }
            },
            |event| {
                let _ = app.emit(
                    "agent-event",
                    AgentPayload {
                        run_id: run_id.clone(),
                        event,
                    },
                );
            },
        );

        if let Ok(mut running) = app.state::<Approvals>().0.lock() {
            running.remove(&run_id);
        }

        if let Ok(mut running) = app.state::<Running>().0.lock() {
            running.remove(&run_id);
        }
    });

    Ok(())
}

/// Answers a permission question of a running turn: `allow` lets the tool run with `input`, otherwise it is denied.
#[tauri::command]
pub fn agent_permission(
    approvals: State<'_, Approvals>,
    run_id: String,
    request_id: String,
    allow: bool,
    input: serde_json::Value,
) -> Result<(), String> {
    let responder = approvals
        .0
        .lock()
        .map_err(|_| "Không gửi được câu trả lời.".to_string())?
        .get(&run_id)
        .cloned()
        .ok_or("Lượt này đã kết thúc.")?;

    agent::respond(&responder, &request_id, allow, &input)
}

/// Stops a running turn (Ctrl+C in the chat): its CLI process is ended, which finishes the turn with what it had so far.
#[tauri::command]
pub fn agent_stop(running: State<'_, Running>, run_id: String) -> Result<(), String> {
    let pid = running
        .0
        .lock()
        .map_err(|_| "Không dừng được lượt này.".to_string())?
        .get(&run_id)
        .copied()
        .ok_or("Lượt này đã kết thúc.")?;
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
        _ => Err("Không dừng được lượt này.".to_string()),
    }
}
