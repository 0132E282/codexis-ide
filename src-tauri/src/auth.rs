//! Sign-in state of the tools Rynox works with: the `claude` and `codex` CLIs (one is needed to chat) and GitHub through the `gh` CLI (optional).
//! Rynox never sees a password or token: signing in runs the tool's own login flow and the state is read back from the tool.

use crate::agent::locate;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

/// How long to wait for `gh` to print its one-time code.
const CODE_WAIT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Codex,
    Github,
}

impl Provider {
    const ALL: [Self; 3] = [Self::Claude, Self::Codex, Self::Github];

    /// Name of the tool whose profiles apply (`claude`, `codex`, `github`).
    pub fn cli(self) -> Option<&'static str> {
        match self {
            Self::Claude => Some("claude"),
            Self::Codex => Some("codex"),
            Self::Github => Some("github"),
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.name() == name)
    }

    fn name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Github => "github",
        }
    }

    fn program(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Github => "gh",
        }
    }

    fn status_args(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["auth", "status"],
            Self::Codex => &["login", "status"],
            Self::Github => &["auth", "status", "--hostname", "github.com"],
        }
    }

    fn logout_args(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["auth", "logout"],
            Self::Codex => &["logout"],
            Self::Github => &["auth", "logout", "--hostname", "github.com"],
        }
    }

    fn login_args(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["auth", "login"],
            Self::Codex => &["login"],
            Self::Github => &[
                "auth",
                "login",
                "--web",
                "--hostname",
                "github.com",
                "--git-protocol",
                "https",
            ],
        }
    }
}

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

/// Longest value kept in a detail row.
const MAX_DETAIL_CHARS: usize = 200;

fn detail(label: &'static str, value: &str) -> Option<Detail> {
    let value: String = value.trim().chars().take(MAX_DETAIL_CHARS).collect();

    (!value.is_empty()).then_some(Detail { label, value })
}

/// Environment that points a CLI at one of its profile folders; empty = the CLI's own login.
pub type Environment = Vec<(&'static str, String)>;

/// Reads the sign-in state of every provider; the AI CLIs are read under the profile `environment_of` gives for them.
pub fn status_all(environment_of: impl Fn(Provider) -> Environment) -> Vec<ProviderStatus> {
    Provider::ALL
        .into_iter()
        .map(|provider| status(provider, &environment_of(provider)))
        .collect()
}

/// Reads the sign-in state of one provider under `environment`.
pub fn status(provider: Provider, environment: &[(&'static str, String)]) -> ProviderStatus {
    let mut result = ProviderStatus {
        provider: provider.name(),
        installed: false,
        logged_in: false,
        account: None,
        details: Vec::new(),
    };
    let Some(program) = locate(provider.program()) else {
        return result;
    };

    result.installed = true;

    let version = Command::new(&program)
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(str::to_string)
        });
    let path = program.display().to_string();

    let Ok(output) = Command::new(&program)
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .args(provider.status_args())
        .stdin(Stdio::null())
        .output()
    else {
        return result;
    };
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    match provider {
        Provider::Claude => {
            let stdout = String::from_utf8_lossy(&output.stdout);

            (result.logged_in, result.account) = claude_state(&stdout);
            result.details = claude_details(&stdout);
        }
        Provider::Codex => {
            result.logged_in = output.status.success();
            result.account = codex_account(environment).filter(|_| result.logged_in);
            result.details = text
                .lines()
                .find_map(|line| detail("Trạng thái", line))
                .into_iter()
                .collect();
        }
        Provider::Github => {
            result.logged_in = output.status.success();
            result.account = github_account(&text).filter(|_| result.logged_in);
            result.details = github_details(&text, result.logged_in);
        }
    }

    result
        .details
        .extend(detail("Phiên bản", &version.unwrap_or_default()));
    result.details.extend(detail("Đường dẫn", &path));

    result
}

/// One line of `claude -p /usage`, e.g. `Current session: 12% used · resets Nov 5 at 12:29am`.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct LimitUsage {
    pub label: String,
    pub percent: u8,
    pub resets: Option<String>,
}

/// Plan usage of a Claude account, read from the CLI's own `/usage` command under `environment`; `None` when the CLI is missing or prints nothing readable.
pub fn claude_usage(environment: &[(&'static str, String)]) -> Option<Vec<LimitUsage>> {
    let program = locate(Provider::Claude.program())?;
    let output = Command::new(program)
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .current_dir(std::env::temp_dir())
        .args(["-p", "/usage"])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let limits = parse_limits(&String::from_utf8_lossy(&output.stdout));

    (!limits.is_empty()).then_some(limits)
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

/// Email in the `id_token` of the Codex login: `<CODEX_HOME>/auth.json`, or `~/.codex/auth.json` for the default account. Only the email claim is read; tokens are never returned.
fn codex_account(environment: &[(&'static str, String)]) -> Option<String> {
    let home = environment
        .iter()
        .find(|(name, _)| *name == "CODEX_HOME")
        .map(|(_, value)| PathBuf::from(value))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))?;
    let text = std::fs::read_to_string(home.join("auth.json")).ok()?;

    id_token_email(&text)
}

fn id_token_email(auth_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(auth_json).ok()?;
    let token = value["tokens"]["id_token"].as_str()?;
    let payload = decode_base64_url(token.split('.').nth(1)?)?;
    let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;

    claims["email"].as_str().map(str::to_string)
}

/// Unpadded URL-safe base64, as in a JWT segment.
fn decode_base64_url(text: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;

    for character in text.bytes() {
        let sextet = match character {
            b'A'..=b'Z' => character - b'A',
            b'a'..=b'z' => character - b'a' + 26,
            b'0'..=b'9' => character - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            b'=' => break,
            _ => return None,
        };

        buffer = (buffer << 6) | u32::from(sextet);
        bits += 6;

        if bits >= 8 {
            bits -= 8;
            bytes.push(u8::try_from((buffer >> bits) & 0xff).ok()?);
        }
    }

    Some(bytes)
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
        ("Tài khoản", "email"),
        ("Phương thức xác thực", "authMethod"),
        ("Nhà cung cấp API", "apiProvider"),
        ("Tổ chức", "orgName"),
        ("Gói", "subscriptionType"),
    ]
    .into_iter()
    .filter_map(|(label, key)| detail(label, value[key].as_str()?))
    .collect()
}

/// Account and protocol from `gh auth status`; its token line is left out on purpose.
fn github_details(text: &str, logged_in: bool) -> Vec<Detail> {
    let protocol = text
        .split_once("Git operations protocol:")
        .and_then(|(_, rest)| rest.lines().next());

    logged_in
        .then(|| github_account(text))
        .flatten()
        .and_then(|account| detail("Tài khoản", &account))
        .into_iter()
        .chain(protocol.and_then(|value| detail("Giao thức Git", value)))
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

/// Starts the provider's own login flow, which opens the browser, and returns at once; the caller polls [`status_all`]. GitHub also returns the one-time code to type on github.com/login/device.
///
/// # Errors
/// Fails when the tool is not installed, cannot start, or (GitHub) prints no code.
pub fn start_login(
    provider: Provider,
    environment: &[(&'static str, String)],
) -> Result<Option<String>, String> {
    let program = locate(provider.program()).ok_or_else(|| {
        format!(
            "Không tìm thấy lệnh `{}`. Cài rồi thử lại.",
            provider.program()
        )
    })?;
    let mut command = Command::new(program);

    command
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .args(provider.login_args())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if provider != Provider::Github {
        command
            .spawn()
            .map_err(|_| format!("Không chạy được `{}`.", provider.program()))?;

        return Ok(None);
    }

    let mut child = command
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Không chạy được `gh`.".to_string())?;

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
            Err("Không lấy được mã xác thực GitHub.".to_string())
        }
    }
}

/// Signs `provider` out under `environment` with the tool's own logout command and waits for it.
///
/// # Errors
/// Fails when the tool is not installed, cannot start, or reports a failure.
pub fn logout(provider: Provider, environment: &[(&'static str, String)]) -> Result<(), String> {
    let program = locate(provider.program()).ok_or_else(|| {
        format!(
            "Không tìm thấy lệnh `{}`. Cài rồi thử lại.",
            provider.program()
        )
    })?;
    let status = Command::new(program)
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .args(provider.logout_args())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| format!("Không chạy được `{}`.", provider.program()))?;

    status
        .success()
        .then_some(())
        .ok_or_else(|| "Không ngắt được kết nối.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_json_gives_state_and_account() {
        assert_eq!(
            claude_state(r#"{"loggedIn": true, "email": "a@b.c"}"#),
            (true, Some("a@b.c".to_string()))
        );
        assert_eq!(
            claude_state(r#"{"loggedIn": false, "email": "a@b.c"}"#),
            (false, None)
        );
        assert_eq!(claude_state("not json"), (false, None));
    }

    #[test]
    fn codex_email_is_read_from_the_id_token() {
        // payload {"email":"a@b.c"}
        let auth =
            r#"{"tokens": {"id_token": "x.eyJlbWFpbCI6ImFAYi5jIn0.y", "access_token": "secret"}}"#;

        assert_eq!(id_token_email(auth), Some("a@b.c".to_string()));
        assert_eq!(id_token_email("{}"), None);
        assert_eq!(id_token_email("not json"), None);
    }

    #[test]
    fn usage_limits_are_read_from_the_usage_output() {
        let text = "You are using your subscription\n\nCurrent session: 12% used · resets Nov 5 at 12:29am (Asia/Saigon)\nCurrent week (all models): 3% used · resets Nov 11 at 10:59am (Asia/Saigon)\n\nLast 24h · 1661 requests";
        let limits = parse_limits(text);

        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].label, "Current session");
        assert_eq!(limits[0].percent, 12);
        assert_eq!(
            limits[1].resets.as_deref(),
            Some("Nov 11 at 10:59am (Asia/Saigon)")
        );
        assert!(parse_limits("nothing here").is_empty());
    }

    #[test]
    fn claude_details_show_only_whitelisted_fields() {
        let details = claude_details(
            r#"{"loggedIn": true, "email": "a@b.c", "authMethod": "claude.ai", "accessToken": "secret"}"#,
        );
        let labels: Vec<&str> = details.iter().map(|row| row.label).collect();

        assert_eq!(labels, ["Tài khoản", "Phương thức xác thực"]);
        assert!(details.iter().all(|row| !row.value.contains("secret")));
    }

    #[test]
    fn github_details_give_account_and_protocol() {
        let text = "  ✓ Logged in to github.com account octocat (keyring)\n  - Git operations protocol: https\n  - Token: gho_************\n";
        let rows = github_details(text, true);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].value, "octocat");
        assert_eq!(rows[1].value, "https");
        assert!(rows.iter().all(|row| !row.value.contains("gho_")));
        assert!(github_details(text, false).len() <= 1);
    }

    #[test]
    fn github_account_is_read_from_the_status_line() {
        let text = "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n";

        assert_eq!(github_account(text), Some("octocat".to_string()));
        assert_eq!(github_account("You are not logged in"), None);
    }

    #[test]
    fn device_code_is_found_in_the_prompt_line() {
        assert_eq!(
            device_code("! First copy your one-time code: AB12-CD34"),
            Some("AB12-CD34".to_string())
        );
        assert_eq!(device_code("Press Enter to open github.com"), None);
        assert_eq!(device_code("ab12-cd34"), None);
    }

    #[test]
    fn provider_names_round_trip() {
        for provider in Provider::ALL {
            assert_eq!(Provider::parse(provider.name()), Some(provider));
        }

        assert_eq!(Provider::parse("gemini"), None);
    }
}
