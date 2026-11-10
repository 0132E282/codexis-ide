//! Antigravity (`agy`): the CLI has no `login`, `logout` or status command. `agy models` doubles as the status check: it lists the models when signed in and fails with "Please sign in" otherwise.
//! The token lives in the system keyring and is never read; the account email is the one the CLI itself logged at its last sign-in.
//! A signed-out `agy -p <prompt>` prints `Authentication required. Please visit the URL to log in:` followed by the URL, then waits for the sign-in.

use super::{AuthTool, SignIn};
use crate::cli::{locate, CliKind};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

pub struct AntigravityAuth;

const SIGNED_IN_MARKER: &str = "authenticated successfully as ";

/// How long a sign-in process may wait: `agy` gives up after 60 seconds by itself, and then the code it was given is still exchanged.
const LOGIN_SECONDS: u64 = 120;

/// How long the sign-in URL may take to appear.
const URL_WAIT_SECONDS: u64 = 20;

/// How long to wait for `agy` to refuse a code before reporting it as sent.
const REPLY_WAIT_MILLISECONDS: u64 = 5000;
const REPLY_POLL_MILLISECONDS: u64 = 100;

/// Longest authorization code accepted; real ones are about 100 characters.
const MAX_CODE_CHARS: usize = 2048;

/// Newest output kept to look for the URL and for the refusal; the URL is about 800 characters.
const KEPT_OUTPUT_CHARS: usize = 4096;

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

    /// Runs the print-mode prompt on a pseudo-terminal (`agy` refuses to sign in without one), opens the sign-in URL it prints and returns it.
    /// The process stays alive for [`LOGIN_SECONDS`], waiting for the sign-in or for the authorization code sent through [`AuthTool::submit_code`].
    fn start_login(
        &self,
        environment: &[(&'static str, String)],
    ) -> Result<Option<String>, String> {
        let program = self.kind().program();
        let path = locate(program).ok_or_else(|| format!("auth.command_missing|{program}"))?;
        let failed = || format!("auth.command_failed|{program}");
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                // * Wide enough that the very long sign-in URL is never wrapped.
                cols: 2000,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| failed())?;
        let mut command = CommandBuilder::new(path);

        command.args(self.login_args());
        command.env("TERM", "xterm-256color");

        for (name, value) in environment {
            command.env(name, value);
        }

        let mut child = pair.slave.spawn_command(command).map_err(|_| failed())?;
        let reader = pair.master.try_clone_reader().map_err(|_| failed())?;
        let writer = pair.master.take_writer().map_err(|_| failed())?;
        let key = login_key(environment);
        let state = Arc::new(LoginState::default());
        let (url_sender, url_receiver) = mpsc::channel();
        let mut watchdog = Terminator {
            killer: child.clone_killer(),
            process_id: child.process_id(),
        };
        let login = Login {
            writer,
            terminator: Terminator {
                killer: child.clone_killer(),
                process_id: child.process_id(),
            },
            state: Arc::clone(&state),
            _master: pair.master,
        };

        // * A second login of the same account replaces the first one, which would otherwise wait on its own for a minute.
        if let Some(previous) = LOGINS.replace(key.clone(), login) {
            previous.stop();
        }

        let reader_state = Arc::clone(&state);

        std::thread::spawn(move || {
            watch_output(reader, &reader_state, &url_sender);
            let _ = child.wait();
            reader_state.finished.store(true, Ordering::SeqCst);
            LOGINS.remove_if_current(&key, &reader_state);
        });

        let watchdog_state = Arc::clone(&state);

        std::thread::spawn(move || {
            for _ in 0..LOGIN_SECONDS {
                if watchdog_state.finished.load(Ordering::SeqCst) {
                    return;
                }

                std::thread::sleep(Duration::from_secs(1));
            }

            watchdog.terminate();
        });

        match url_receiver.recv_timeout(Duration::from_secs(URL_WAIT_SECONDS)) {
            Ok(url) => {
                open_in_browser(&url);

                Ok(Some(url))
            }
            // * The process ended without asking for a sign-in: nothing to wait for.
            Err(mpsc::RecvTimeoutError::Disconnected) => Ok(None),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.cancel_login(environment);

                Err("auth.login_failed".to_string())
            }
        }
    }

    /// Types the authorization code of the sign-in page into the waiting `agy` and reports whether it was refused.
    /// The code is never logged or kept.
    fn submit_code(
        &self,
        environment: &[(&'static str, String)],
        code: &str,
    ) -> Result<(), String> {
        let code = check_code(code)?;
        let state = LOGINS
            .send_line(&login_key(environment), code)
            .ok_or_else(|| "auth.no_pending_login".to_string())?
            .map_err(|_| "auth.code_failed".to_string())?;

        for _ in 0..(REPLY_WAIT_MILLISECONDS / REPLY_POLL_MILLISECONDS) {
            if state.rejected.load(Ordering::SeqCst) {
                return Err("auth.code_rejected".to_string());
            }

            if state.finished.load(Ordering::SeqCst) {
                break;
            }

            std::thread::sleep(Duration::from_millis(REPLY_POLL_MILLISECONDS));
        }

        // * The process may have ended right after the last check.
        if state.rejected.load(Ordering::SeqCst) {
            return Err("auth.code_rejected".to_string());
        }

        Ok(())
    }

    fn cancel_login(&self, environment: &[(&'static str, String)]) {
        if let Some(login) = LOGINS.take(&login_key(environment)) {
            login.stop();
        }
    }

    fn logout(&self, _environment: &[(&'static str, String)]) -> Result<(), String> {
        Err("auth.logout_unsupported".to_string())
    }
}

/// What the reader thread learned from the output of a sign-in process.
#[derive(Default)]
struct LoginState {
    /// `agy` printed that the authentication failed (a wrong code, or the 60 seconds ran out).
    rejected: AtomicBool,
    /// The process ended.
    finished: AtomicBool,
}

/// Ends a sign-in process for good: `agy` ignores the hang-up `portable-pty` sends and would wait out its own minute, so it is killed outright.
struct Terminator {
    killer: Box<dyn ChildKiller + Send + Sync>,
    process_id: Option<u32>,
}

impl Terminator {
    fn terminate(&mut self) {
        let _ = self.killer.kill();

        #[cfg(unix)]
        if let Some(process_id) = self.process_id {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &process_id.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

/// A sign-in process waiting for its code.
struct Login {
    writer: Box<dyn Write + Send>,
    terminator: Terminator,
    state: Arc<LoginState>,
    /// Kept open: closing the master hangs the process up.
    _master: Box<dyn MasterPty + Send>,
}

impl Login {
    fn stop(mut self) {
        self.terminator.terminate();
    }
}

/// The sign-in processes waiting right now, by account.
struct PendingLogins(Mutex<Vec<(String, Login)>>);

static LOGINS: PendingLogins = PendingLogins(Mutex::new(Vec::new()));

impl PendingLogins {
    fn entries(&self) -> MutexGuard<'_, Vec<(String, Login)>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Stores `login` for `key`; returns the one it replaced.
    fn replace(&self, key: String, login: Login) -> Option<Login> {
        let mut entries = self.entries();
        let previous = entries
            .iter()
            .position(|(existing, _)| *existing == key)
            .map(|index| entries.remove(index).1);

        entries.push((key, login));
        previous
    }

    fn take(&self, key: &str) -> Option<Login> {
        let mut entries = self.entries();
        let index = entries.iter().position(|(existing, _)| existing == key)?;

        Some(entries.remove(index).1)
    }

    /// Drops the entry of `key` when it still belongs to the process of `state`.
    fn remove_if_current(&self, key: &str, state: &Arc<LoginState>) {
        self.entries()
            .retain(|(existing, login)| existing != key || !Arc::ptr_eq(&login.state, state));
    }

    /// Writes `line` and Enter to the process of `key`; `None` when none is waiting.
    fn send_line(&self, key: &str, line: &str) -> Option<std::io::Result<Arc<LoginState>>> {
        let mut entries = self.entries();
        let (_, login) = entries.iter_mut().find(|(existing, _)| existing == key)?;
        let written = login
            .writer
            .write_all(format!("{line}\r").as_bytes())
            .and_then(|()| login.writer.flush());

        Some(written.map(|()| Arc::clone(&login.state)))
    }
}

/// One waiting sign-in per account: the config folder of the profile, or empty for the CLI's own login.
fn login_key(environment: &[(&'static str, String)]) -> String {
    environment
        .iter()
        .find(|(name, _)| *name == CliKind::Antigravity.config_variable())
        .map(|(_, value)| value.clone())
        .unwrap_or_default()
}

/// Reads the output of the process until it closes: sends the sign-in URL once and notes a refusal.
/// The output is never logged or stored beyond the newest [`KEPT_OUTPUT_CHARS`] characters.
fn watch_output(mut reader: impl Read, state: &LoginState, url_sender: &mpsc::Sender<String>) {
    let mut buffer = [0u8; 4096];
    let mut recent = String::new();
    let mut url_sent = false;

    while let Ok(read) = reader.read(&mut buffer) {
        if read == 0 {
            break;
        }

        recent.push_str(&String::from_utf8_lossy(&buffer[..read]));

        let excess = recent.chars().count().saturating_sub(KEPT_OUTPUT_CHARS);

        if excess > 0 {
            recent = recent.chars().skip(excess).collect();
        }

        if !url_sent {
            if let Some(url) = find_url(&recent) {
                url_sent = true;
                let _ = url_sender.send(url);
            }
        }

        if is_rejection(&recent) {
            state.rejected.store(true, Ordering::SeqCst);
        }
    }
}

/// The first complete `https://` URL of `output`: it ends at the first whitespace or control character, which must have arrived.
fn find_url(output: &str) -> Option<String> {
    let rest = &output[output.find("https://")?..];
    let end = rest.find(|character: char| character.is_whitespace() || character.is_control())?;

    Some(rest[..end].to_string())
}

/// `agy` says "authentication failed" for a refused code and for the timeout alike.
fn is_rejection(output: &str) -> bool {
    output.to_lowercase().contains("authentication failed")
}

/// The code without the spaces around it, when it can be typed as one line.
fn check_code(code: &str) -> Result<&str, String> {
    let code = code.trim();
    let valid = !code.is_empty()
        && code.chars().count() <= MAX_CODE_CHARS
        && !code.chars().any(char::is_control);

    valid
        .then_some(code)
        .ok_or_else(|| "auth.code_invalid".to_string())
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
