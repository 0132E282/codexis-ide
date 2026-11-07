//! Claude Code: sign-in state from `claude auth status` (JSON) and plan usage from `claude -p /usage`.

use super::{detail, AuthTool, Detail, SignIn};
use crate::cli::{command, locate, CliKind};
use serde::Serialize;
use std::process::Output;

pub struct ClaudeAuth;

/// One line of `claude -p /usage`, e.g. `Current session: 12% used · resets Nov 5 at 12:29am`.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct LimitUsage {
    pub label: String,
    pub percent: u8,
    pub resets: Option<String>,
}

impl AuthTool for ClaudeAuth {
    fn kind(&self) -> CliKind {
        CliKind::Claude
    }

    fn status_args(&self) -> &'static [&'static str] {
        &["auth", "status"]
    }

    fn login_args(&self) -> &'static [&'static str] {
        &["auth", "login"]
    }

    fn logout_args(&self) -> &'static [&'static str] {
        &["auth", "logout"]
    }

    fn read_sign_in(&self, output: &Output, _environment: &[(&'static str, String)]) -> SignIn {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let (logged_in, account) = claude_state(&stdout);

        SignIn {
            logged_in,
            account,
            details: claude_details(&stdout),
        }
    }
}

impl ClaudeAuth {
    /// Plan usage of a Claude account, read from the CLI's own `/usage` command under `environment`; `None` when the CLI is missing or prints nothing readable.
    pub fn usage(&self, environment: &[(&'static str, String)]) -> Option<Vec<LimitUsage>> {
        let program = locate(self.kind().program())?;
        let output = command(&program, environment)
            .current_dir(std::env::temp_dir())
            .args(["-p", "/usage"])
            .output()
            .ok()?;
        let limits = parse_limits(&String::from_utf8_lossy(&output.stdout));

        (!limits.is_empty()).then_some(limits)
    }
}

fn parse_limits(text: &str) -> Vec<LimitUsage> {
    text.lines()
        .filter_map(|line| {
            let (label, rest) = line.trim().split_once(": ")?;
            let (percent, rest) = rest.split_once("% used")?;
            let percent = percent.trim().parse::<u8>().ok()?;

            label.starts_with("Current ").then(|| LimitUsage {
                label: label.to_string(),
                percent,
                resets: rest
                    .split_once("resets ")
                    .map(|(_, resets)| resets.trim().to_string()),
            })
        })
        .collect()
}

/// `claude auth status` prints JSON such as `{"loggedIn": true, "email": "..."}`.
fn claude_state(stdout: &str) -> (bool, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout) else {
        return (false, None);
    };
    let logged_in = value["loggedIn"].as_bool().unwrap_or(false);
    let account = value["email"].as_str().map(str::to_string);

    (logged_in, account.filter(|_| logged_in))
}

/// Whitelisted fields of the `claude auth status` JSON; anything else (tokens included) is never shown.
fn claude_details(stdout: &str) -> Vec<Detail> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout) else {
        return Vec::new();
    };

    [
        ("auth.detail.account", "email"),
        ("auth.detail.auth_method", "authMethod"),
        ("auth.detail.api_provider", "apiProvider"),
        ("auth.detail.organization", "orgName"),
        ("auth.detail.plan", "subscriptionType"),
    ]
    .into_iter()
    .filter_map(|(label, key)| detail(label, value[key].as_str()?))
    .collect()
}

#[cfg(test)]
#[path = "../../tests/unit/auth_claude.rs"]
mod tests;
