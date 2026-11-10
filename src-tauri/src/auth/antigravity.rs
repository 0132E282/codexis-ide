//! Antigravity (`agy`): the CLI has no `login`, `logout` or status command. `agy models` doubles as the status check: it lists the models when signed in and fails with "Please sign in" otherwise.
//! The token lives in the system keyring and is never read; the account email is the one the CLI itself logged at its last sign-in.
//! A signed-out `agy -p <prompt>` prints `Authentication required. Please visit the URL to log in:` followed by the URL, then waits for the sign-in.

use super::{login_command, AuthTool, SignIn};
use crate::cli::CliKind;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Output, Stdio};

pub struct AntigravityAuth;

const SIGNED_IN_MARKER: &str = "authenticated successfully as ";

impl AuthTool for AntigravityAuth {
    fn kind(&self) -> CliKind {
        CliKind::Antigravity
    }

    fn status_args(&self) -> &'static [&'static str] {
        &["models"]
    }

    /// A one-word prompt in print mode: signed out it asks for the sign-in before any model call.
    fn login_args(&self) -> &'static [&'static str] {
        &["--print=hi"]
    }

    /// Not a command: `agy` only signs out from its `/logout` slash command, inside the interactive session.
    fn logout_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn read_sign_in(&self, output: &Output, environment: &[(&'static str, String)]) -> SignIn {
        let logged_in = output.status.success() && !output.stdout.is_empty();
        let account = logged_in.then(|| latest_account(environment)).flatten();

        SignIn {
            logged_in,
            account,
            details: Vec::new(),
        }
    }

    /// Runs the print-mode prompt and opens the sign-in URL it prints; the process stays alive waiting for the sign-in.
    fn start_login(
        &self,
        environment: &[(&'static str, String)],
    ) -> Result<Option<String>, String> {
        let program = self.kind().program();
        let mut child = login_command(self, environment)?
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|_| format!("auth.command_failed|{program}"))?;
        let Some(stdout) = child.stdout.take() else {
            return Ok(None);
        };

        std::thread::spawn(move || {
            let url = BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
                .map(|line| line.trim().to_string())
                .find(|line| line.starts_with("https://"));

            if let Some(url) = url {
                open_in_browser(&url);
            }

            let _ = child.wait();
        });

        Ok(None)
    }

    fn logout(&self, _environment: &[(&'static str, String)]) -> Result<(), String> {
        Err("auth.logout_unsupported".to_string())
    }
}

fn open_in_browser(url: &str) {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };

    let _ = std::process::Command::new(opener)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// `<HOME>/.gemini/antigravity-cli/log`, with `HOME` of the profile or of the process.
fn log_folder(environment: &[(&'static str, String)]) -> Option<PathBuf> {
    environment
        .iter()
        .find(|(name, _)| *name == CliKind::Antigravity.config_variable())
        .map(|(_, value)| PathBuf::from(value))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .map(|home| home.join(".gemini/antigravity-cli/log"))
}

/// The email of the last sign-in line in the newest log of the CLI.
fn latest_account(environment: &[(&'static str, String)]) -> Option<String> {
    let newest = std::fs::read_dir(log_folder(environment)?)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
        .max_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok())?;

    account_in_log(&std::fs::read_to_string(newest.path()).ok()?)
}

/// The email after the last `authenticated successfully as` in `log`.
fn account_in_log(log: &str) -> Option<String> {
    log.lines()
        .rev()
        .find_map(|line| line.split_once(SIGNED_IN_MARKER))
        .map(|(_, email)| email.trim().to_string())
        .filter(|email| !email.is_empty())
}

#[cfg(test)]
#[path = "../../tests/unit/auth_antigravity.rs"]
mod tests;
