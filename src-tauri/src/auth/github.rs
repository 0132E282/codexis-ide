//! GitHub through the `gh` CLI: sign-in state, the device-flow login and the public profile of the account.

use super::{combined_text, detail, login_command, AuthTool, Detail, SignIn};
use crate::cli::{command, locate, CliKind};
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Output, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

/// How long to wait for `gh` to print its one-time code.
const CODE_WAIT: Duration = Duration::from_secs(15);
/// Avatars are only taken from GitHub's own image host.
const AVATAR_HOST: &str = "https://avatars.githubusercontent.com/";
/// Largest avatar kept (the settings accept data URLs up to 300 000 bytes).
const MAX_AVATAR_BYTES: usize = 200_000;

pub struct GithubAuth;

/// Public profile of the signed-in GitHub account, read through the `gh` CLI: no token ever reaches the app.
#[derive(Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GithubProfile {
    pub login: String,
    /// Display name; empty when the account has none.
    pub name: String,
    /// Public email; empty when the account keeps it private.
    pub email: String,
    /// The avatar as an image data URL; empty when it could not be downloaded.
    pub avatar: String,
}

impl AuthTool for GithubAuth {
    fn kind(&self) -> CliKind {
        CliKind::Github
    }

    fn status_args(&self) -> &'static [&'static str] {
        &["auth", "status", "--hostname", "github.com"]
    }

    fn login_args(&self) -> &'static [&'static str] {
        &[
            "auth",
            "login",
            "--web",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
        ]
    }

    fn logout_args(&self) -> &'static [&'static str] {
        &["auth", "logout", "--hostname", "github.com"]
    }

    fn read_sign_in(&self, output: &Output, _environment: &[(&'static str, String)]) -> SignIn {
        let text = combined_text(output);
        let logged_in = output.status.success();

        SignIn {
            logged_in,
            account: github_account(&text).filter(|_| logged_in),
            details: github_details(&text, logged_in),
        }
    }

    /// Starts `gh`'s web login and returns the one-time code it prints, to type on github.com/login/device.
    fn start_login(
        &self,
        environment: &[(&'static str, String)],
    ) -> Result<Option<String>, String> {
        let mut child = login_command(self, environment)?
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "auth.gh_failed".to_string())?;

        if let Some(mut stdin) = child.stdin.take() {
            // `gh` waits for Enter before opening the browser.
            let _ = stdin.write_all(b"\n");
        }

        let stderr = child.stderr.take();
        let (sender, receiver) = mpsc::channel();

        std::thread::spawn(move || {
            if let Some(stderr) = stderr {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if let Some(code) = device_code(&line) {
                        let _ = sender.send(code);
                    }
                }
            }

            let _ = child.wait();
        });

        match receiver.recv_timeout(CODE_WAIT) {
            Ok(code) => Ok(Some(code)),
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
                Err("auth.github_code_failed".to_string())
            }
        }
    }
}

impl GithubAuth {
    /// Reads the profile of the GitHub account `gh` is signed in with (`gh api user`) and downloads its avatar.
    ///
    /// # Errors
    /// Fails when `gh` is missing, is not signed in or answers something that is not a profile.
    pub fn profile(&self, environment: &[(&'static str, String)]) -> Result<GithubProfile, String> {
        let program = locate(self.kind().program()).ok_or("auth.gh_missing")?;
        let output = command(&program, environment)
            .args(["api", "user"])
            .output()
            .map_err(|_| "auth.gh_failed".to_string())?;

        if !output.status.success() {
            return Err("auth.github_signed_out".to_string());
        }

        let value: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "github.profile_unreadable".to_string())?;
        let text = |key: &str| value[key].as_str().unwrap_or_default().trim().to_string();
        let login = text("login");

        if login.is_empty() {
            return Err("github.profile_unreadable".to_string());
        }

        Ok(GithubProfile {
            name: text("name"),
            email: text("email"),
            avatar: avatar_data_url(&text("avatar_url")).unwrap_or_default(),
            login,
        })
    }
}

/// Downloads a small avatar from GitHub's image host (`curl`, a short time limit) as a data URL.
fn avatar_data_url(url: &str) -> Option<String> {
    if !url.starts_with(AVATAR_HOST) {
        return None;
    }

    let separator = if url.contains('?') { '&' } else { '?' };
    let output = std::process::Command::new("curl")
        .args(["-sSfL", "--max-time", "10", "--max-filesize", "500000"])
        .arg(format!("{url}{separator}s=128"))
        .stdin(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.len() > MAX_AVATAR_BYTES {
        return None;
    }

    let mime = image_mime(&output.stdout)?;

    Some(format!(
        "data:{mime};base64,{}",
        base64_encode(&output.stdout)
    ))
}

/// The image type named by the first bytes of a file; only the types the settings accept.
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let group = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));

        for index in 0..4 {
            if index <= chunk.len() {
                encoded.push(ALPHABET[((group >> (18 - 6 * index)) & 0x3F) as usize] as char);
            } else {
                encoded.push('=');
            }
        }
    }

    encoded
}

/// Account and protocol from `gh auth status`; its token line is left out on purpose.
fn github_details(text: &str, logged_in: bool) -> Vec<Detail> {
    let protocol = text
        .split_once("Git operations protocol:")
        .and_then(|(_, rest)| rest.lines().next());

    logged_in
        .then(|| github_account(text))
        .flatten()
        .and_then(|account| detail("auth.detail.account", &account))
        .into_iter()
        .chain(protocol.and_then(|value| detail("auth.detail.git_protocol", value)))
        .collect()
}

/// Account name in a line such as `Logged in to github.com account octocat (keyring)`.
fn github_account(text: &str) -> Option<String> {
    let (_, rest) = text.split_once(" account ")?;

    rest.split_whitespace().next().map(str::to_string)
}

/// The one-time code of GitHub's device flow, shaped `XXXX-XXXX`.
fn device_code(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|word| {
            word.len() == 9
                && word.char_indices().all(|(index, c)| {
                    if index == 4 {
                        c == '-'
                    } else {
                        c.is_ascii_uppercase() || c.is_ascii_digit()
                    }
                })
        })
        .map(str::to_string)
}

#[cfg(test)]
#[path = "../../tests/unit/auth_github.rs"]
mod tests;
