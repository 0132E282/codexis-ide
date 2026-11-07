//! Sign-in state of the tools Rynox works with: the `claude` and `codex` CLIs (one is needed to chat) and GitHub through the `gh` CLI (optional).
//! Rynox never sees a password or token: signing in runs the tool's own login flow and the state is read back from the tool.
//!
//! [`AuthTool`] is the shared flow (Template Method): each tool only gives its arguments and reads its own status output.

mod claude;
mod codex;
mod github;

use crate::cli::{command, locate, CliKind, Environment};
use serde::Serialize;
use std::process::{Command, Output, Stdio};

pub use claude::{ClaudeAuth, LimitUsage};
pub use codex::CodexAuth;
pub use github::{GithubAuth, GithubProfile};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: &'static str,
    pub installed: bool,
    pub logged_in: bool,
    pub account: Option<String>,
    /// Label and value rows for the detail table; never tokens or keys.
    pub details: Vec<Detail>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Detail {
    pub label: &'static str,
    pub value: String,
}

/// What a tool's status output says about the sign-in.
#[derive(Debug, PartialEq, Eq)]
pub struct SignIn {
    pub logged_in: bool,
    pub account: Option<String>,
    pub details: Vec<Detail>,
}

/// Longest value kept in a detail row.
const MAX_DETAIL_CHARS: usize = 200;

fn detail(label: &'static str, value: &str) -> Option<Detail> {
    let value: String = value.trim().chars().take(MAX_DETAIL_CHARS).collect();

    (!value.is_empty()).then_some(Detail { label, value })
}

/// Standard output and standard error of a command, one after the other.
fn combined_text(output: &Output) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

/// A tool with a sign-in: the CLI's own status, login and logout commands.
pub trait AuthTool: Sync {
    fn kind(&self) -> CliKind;

    fn status_args(&self) -> &'static [&'static str];

    fn login_args(&self) -> &'static [&'static str];

    fn logout_args(&self) -> &'static [&'static str];

    /// Reads the sign-in state from the output of the status command.
    fn read_sign_in(&self, output: &Output, environment: &[(&'static str, String)]) -> SignIn;

    /// Reads the sign-in state under `environment`: finds the program, asks its version and status, then lets [`AuthTool::read_sign_in`] read the answer.
    fn status(&self, environment: &[(&'static str, String)]) -> ProviderStatus {
        let kind = self.kind();
        let mut result = ProviderStatus {
            provider: kind.name(),
            installed: false,
            logged_in: false,
            account: None,
            details: Vec::new(),
        };
        let Some(program) = locate(kind.program()) else {
            return result;
        };

        result.installed = true;

        let version = command(&program, environment)
            .arg("--version")
            .output()
            .ok()
            .and_then(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(str::to_string)
            });
        let path = program.display().to_string();

        let Ok(output) = command(&program, environment)
            .args(self.status_args())
            .output()
        else {
            return result;
        };
        let sign_in = self.read_sign_in(&output, environment);

        result.logged_in = sign_in.logged_in;
        result.account = sign_in.account;
        result.details = sign_in.details;
        result
            .details
            .extend(detail("auth.detail.version", &version.unwrap_or_default()));
        result.details.extend(detail("auth.detail.path", &path));

        result
    }

    /// Starts the tool's own login flow, which opens the browser, and returns at once; the caller polls [`status_all`]. Tools that show a one-time code return it.
    ///
    /// # Errors
    /// Fails when the tool is not installed or cannot start.
    fn start_login(
        &self,
        environment: &[(&'static str, String)],
    ) -> Result<Option<String>, String> {
        let program = self.kind().program();

        login_command(self, environment)?
            .spawn()
            .map_err(|_| format!("auth.command_failed|{program}"))?;

        Ok(None)
    }

    /// Signs out under `environment` with the tool's own logout command and waits for it.
    ///
    /// # Errors
    /// Fails when the tool is not installed, cannot start, or reports a failure.
    fn logout(&self, environment: &[(&'static str, String)]) -> Result<(), String> {
        let program = self.kind().program();
        let path = locate(program).ok_or_else(|| format!("auth.command_missing|{program}"))?;
        let status = command(&path, environment)
            .args(self.logout_args())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| format!("auth.command_failed|{program}"))?;

        status
            .success()
            .then_some(())
            .ok_or_else(|| "auth.logout_failed".to_string())
    }
}

/// The login command of `tool`, with no output kept, ready to spawn.
fn login_command<T: AuthTool + ?Sized>(
    tool: &T,
    environment: &[(&'static str, String)],
) -> Result<Command, String> {
    let program = tool.kind().program();
    let path = locate(program).ok_or_else(|| format!("auth.command_missing|{program}"))?;
    let mut login = command(&path, environment);

    login
        .args(tool.login_args())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    Ok(login)
}

impl CliKind {
    /// The sign-in side of this CLI.
    pub fn auth(self) -> &'static dyn AuthTool {
        match self {
            Self::Claude => &ClaudeAuth,
            Self::Codex => &CodexAuth,
            Self::Github => &GithubAuth,
        }
    }
}

/// Reads the sign-in state of every tool, in the order of [`CliKind::ALL`]; the AI CLIs are read under the profile `environment_of` gives for them.
pub fn status_all(environment_of: impl Fn(CliKind) -> Environment) -> Vec<ProviderStatus> {
    let environments: Vec<(CliKind, Environment)> = CliKind::ALL
        .into_iter()
        .map(|kind| (kind, environment_of(kind)))
        .collect();

    // * Each tool is a slow process of its own: they are read at the same time, so the wait is the slowest one, not the sum.
    std::thread::scope(|scope| {
        let handles: Vec<_> = environments
            .iter()
            .map(|(kind, environment)| scope.spawn(move || kind.auth().status(environment)))
            .collect();

        handles
            .into_iter()
            .map(|handle| handle.join().expect("the status thread panicked"))
            .collect()
    })
}

#[cfg(test)]
#[path = "../tests/unit/auth.rs"]
mod tests;
