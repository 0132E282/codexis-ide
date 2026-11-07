use super::state::AppState;
use crate::cli::{self, CliKind};
use crate::git::GitRepo;
use crate::profiles::ProfileStore;
use crate::remote::Remote;
use crate::session_rail::{self, GithubStatus, OutputFile, PullRequest, RepoRef};
use crate::usage::UsageStore;
use crate::validation;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// The "Environment" block: the folder (home written as `~`), the current branch and whether the phone server runs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReply {
    folder: String,
    branch: Option<String>,
    remote_running: bool,
}

/// The "Outputs" block: files the AI wrote in the conversation.
#[derive(Debug, Serialize)]
pub struct OutputsReply {
    files: Vec<OutputFile>,
}

/// The "GitHub" block; every field but `status` is empty when it could not be read.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReply {
    status: GithubStatus,
    account: Option<String>,
    repo: Option<RepoRef>,
    branch: Option<String>,
    pull_request: Option<PullRequest>,
}

/// The "Usage" block: sizes of the open conversation and the last 24 hours over every project. Tokens are estimated from text length; the CLI reports no cost or duration, so none is shown.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReply {
    conversation: Option<ConversationUsageReply>,
    today: TodayUsageReply,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationUsageReply {
    turns: i64,
    failed_turns: i64,
    prompt_tokens: i64,
    answer_tokens: i64,
    /// CLI of the newest turn; the model itself is not saved, the rail takes it from the context the chat reports.
    cli: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TodayUsageReply {
    turns: i64,
    tokens: i64,
}

fn home_folder() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[tauri::command]
pub async fn session_rail_environment(
    state: State<'_, AppState>,
    remote: State<'_, Remote>,
    root: Option<String>,
) -> Result<EnvironmentReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let remote_running = remote.is_running();

    super::blocking("session_rail.environment_failed", move || {
        Ok(EnvironmentReply {
            folder: session_rail::shorten_home(workspace.root(), home_folder().as_deref()),
            branch: GitRepo::new(&workspace).branches().current,
            remote_running,
        })
    })
    .await
}

/// Files the AI created or changed in `conversation` (read from its saved steps), each once and still on disk.
#[tauri::command]
pub async fn session_rail_outputs(
    state: State<'_, AppState>,
    root: Option<String>,
    conversation: i64,
) -> Result<OutputsReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let key = state.workspace_key(root.as_deref())?;
    let turns = state
        .lock_chats()
        .steps_of(&key, conversation)
        .map_err(|error| error.to_string())?;

    super::blocking("session_rail.outputs_failed", move || {
        let base = workspace.root().to_path_buf();
        let files = session_rail::output_files(&turns, &base, |path| base.join(path).is_file());

        Ok(OutputsReply { files })
    })
    .await
}

/// Reads GitHub for the project: the account `gh` is signed in with, the `origin` repository, the branch and its open pull request. Read-only; any failure is a status, never an error.
#[tauri::command]
pub async fn session_rail_github(
    state: State<'_, AppState>,
    profiles: State<'_, ProfileStore>,
    root: Option<String>,
) -> Result<GithubReply, String> {
    let workspace = state.workspace_for(root.as_deref())?;
    let environment = profiles.active_environment(CliKind::Github.name());

    super::blocking("session_rail.github_failed", move || {
        let mut reply = GithubReply {
            status: GithubStatus::NoCli,
            account: None,
            repo: None,
            branch: None,
            pull_request: None,
        };
        let Some(program) = cli::locate(CliKind::Github.program()) else {
            return Ok(reply);
        };
        let sign_in = CliKind::Github.auth().status(&environment);

        if !sign_in.logged_in {
            reply.status = GithubStatus::SignedOut;
            return Ok(reply);
        }

        reply.account = sign_in.account;
        reply.status = GithubStatus::NoRemote;

        let git = GitRepo::new(&workspace);
        let Some(repo) = git
            .origin_url()
            .and_then(|url| session_rail::parse_github_remote(&url))
        else {
            return Ok(reply);
        };

        reply.status = GithubStatus::Ok;
        reply.branch = git
            .branches()
            .current
            .filter(|branch| validation::branch_name(branch).is_ok());
        reply.pull_request = reply.branch.as_deref().and_then(|branch| {
            let output = cli::command(&program, &environment)
                .args(["pr", "list", "--repo"])
                .arg(format!("{}/{}", repo.owner, repo.name))
                .args(["--head", branch, "--state", "open", "--limit", "1"])
                .args(["--json", "number,title,url"])
                .current_dir(workspace.root())
                .output()
                .ok()?;

            output
                .status
                .success()
                .then(|| session_rail::parse_pull_request(&String::from_utf8_lossy(&output.stdout)))
                .flatten()
        });
        reply.repo = Some(repo);

        Ok(reply)
    })
    .await
}

/// Sizes of `conversation` (from its saved turns) and of the last 24 hours (from `usage_events`, all projects, the account in use for each CLI). Read-only.
#[tauri::command]
pub async fn session_rail_usage(
    state: State<'_, AppState>,
    usage: State<'_, Mutex<UsageStore>>,
    profiles: State<'_, ProfileStore>,
    root: Option<String>,
    conversation: Option<i64>,
) -> Result<UsageReply, String> {
    let key = state.workspace_key(root.as_deref())?;
    let size = match conversation {
        Some(id) => Some(
            state
                .lock_chats()
                .size_of(&key, id)
                .map_err(|error| error.to_string())?,
        ),
        None => None,
    };
    let stats = usage
        .lock()
        .map_err(|_| "usage.unavailable".to_string())?
        .stats(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(0)),
            |cli| profiles.active_id(cli),
        )
        .map_err(str::to_string)?;

    Ok(UsageReply {
        conversation: size.map(|size| ConversationUsageReply {
            turns: size.turns,
            failed_turns: size.failed_turns,
            prompt_tokens: session_rail::estimate_tokens(size.prompt_characters),
            answer_tokens: session_rail::estimate_tokens(size.answer_characters),
            cli: size.last_cli,
        }),
        today: TodayUsageReply {
            turns: stats.clis.iter().map(|cli| cli.turns_24h).sum(),
            tokens: stats.clis.iter().map(|cli| cli.tokens_24h).sum(),
        },
    })
}
