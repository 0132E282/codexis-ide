//! Gemini: the CLI has no `login`, `logout` or status command, so the state is read from its own files under `<GEMINI_CLI_HOME or ~>/.gemini`:
//! `oauth_creds.json` exists after a "Login with Google", and `google_accounts.json` names the active email. Tokens are never read.

use super::{login_command, AuthTool, SignIn};
use crate::cli::CliKind;
use std::path::PathBuf;
use std::process::Output;

pub struct GeminiAuth;

const CREDENTIALS_FILE: &str = "oauth_creds.json";
const ACCOUNTS_FILE: &str = "google_accounts.json";

impl AuthTool for GeminiAuth {
    fn kind(&self) -> CliKind {
        CliKind::Gemini
    }

    fn status_args(&self) -> &'static [&'static str] {
        &["--version"]
    }

    /// A one-word prompt in headless mode: with `GOOGLE_GENAI_USE_GCA` the CLI signs in with Google in the browser first, then answers.
    fn login_args(&self) -> &'static [&'static str] {
        &["--prompt", "hi"]
    }

    /// Not a command: [`AuthTool::logout`] removes the CLI's cached credential files.
    fn logout_args(&self) -> &'static [&'static str] {
        &[]
    }

    fn read_sign_in(&self, _output: &Output, environment: &[(&'static str, String)]) -> SignIn {
        let folder = gemini_folder(environment);
        let logged_in = folder
            .as_ref()
            .is_some_and(|folder| folder.join(CREDENTIALS_FILE).is_file());
        let account = folder
            .filter(|_| logged_in)
            .and_then(|folder| std::fs::read_to_string(folder.join(ACCOUNTS_FILE)).ok())
            .and_then(|text| active_account(&text));

        SignIn {
            logged_in,
            account,
            details: Vec::new(),
        }
    }

    fn start_login(
        &self,
        environment: &[(&'static str, String)],
    ) -> Result<Option<String>, String> {
        let program = self.kind().program();

        login_command(self, environment)?
            .env("GOOGLE_GENAI_USE_GCA", "true")
            .spawn()
            .map_err(|_| format!("auth.command_failed|{program}"))?;

        Ok(None)
    }

    fn logout(&self, environment: &[(&'static str, String)]) -> Result<(), String> {
        let folder = gemini_folder(environment).ok_or("auth.logout_failed")?;

        // * The same two files the CLI's own "clear credentials" removes (the account file is kept but its active email cleared).
        match std::fs::remove_file(folder.join(CREDENTIALS_FILE)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("auth.logout_failed".to_string()),
        }

        match std::fs::remove_file(folder.join(ACCOUNTS_FILE)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("auth.logout_failed".to_string()),
        }
    }
}

/// `<GEMINI_CLI_HOME>/.gemini`, or `~/.gemini` for the default account.
fn gemini_folder(environment: &[(&'static str, String)]) -> Option<PathBuf> {
    environment
        .iter()
        .find(|(name, _)| *name == CliKind::Gemini.config_variable())
        .map(|(_, value)| PathBuf::from(value))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .map(|home| home.join(".gemini"))
}

/// The `active` email of `google_accounts.json`; `None` when empty or null.
fn active_account(accounts_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(accounts_json).ok()?;

    value["active"]
        .as_str()
        .filter(|email| !email.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
#[path = "../../tests/unit/auth_gemini.rs"]
mod tests;
