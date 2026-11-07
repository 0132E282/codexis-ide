//! Real shells for the terminal panel: each one runs in a pseudo-terminal in the project folder.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const READ_CHUNK: usize = 8192;
const MAX_SESSIONS: usize = 16;
const MAX_ID_BYTES: usize = 64;
const MAX_WRITE_BYTES: usize = 64 * 1024;
const MAX_DIMENSION: u16 = 500;

/// What a shell printed, sent to the panel as the `terminal-data` event.
#[derive(Debug, Clone, Serialize)]
pub struct TerminalData {
    pub id: String,
    pub data: String,
}

#[derive(Debug)]
pub enum TerminalError {
    Pty(String),
    Unknown(String),
    Poisoned,
    BadId,
    Exists,
    TooMany,
    BadSize,
    TooLarge,
}

impl std::fmt::Display for TerminalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pty(message) => write!(f, "terminal.failed|{message}"),
            Self::Unknown(id) => write!(f, "terminal.unknown|{id}"),
            Self::Poisoned => write!(f, "terminal.unavailable"),
            Self::BadId => write!(f, "terminal.bad_id"),
            Self::Exists => write!(f, "terminal.exists"),
            Self::TooMany => write!(f, "terminal.too_many"),
            Self::BadSize => write!(f, "terminal.bad_size"),
            Self::TooLarge => write!(f, "terminal.too_large"),
        }
    }
}

impl std::error::Error for TerminalError {}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
}

/// The open shells by the id the panel gave them.
#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<String, Session>>,
}

fn pty_error(error: impl std::fmt::Display) -> TerminalError {
    TerminalError::Pty(error.to_string())
}

/// An id the panel may use: 1 to 64 letters, digits, `_` or `-`.
fn check_id(id: &str) -> Result<(), TerminalError> {
    let valid = !id.is_empty()
        && id.len() <= MAX_ID_BYTES
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));

    if valid {
        Ok(())
    } else {
        Err(TerminalError::BadId)
    }
}

fn check_size(columns: u16, rows: u16) -> Result<(), TerminalError> {
    if (1..=MAX_DIMENSION).contains(&columns) && (1..=MAX_DIMENSION).contains(&rows) {
        Ok(())
    } else {
        Err(TerminalError::BadSize)
    }
}

fn shell_program() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string())
    }
}

/// Splits `bytes` into the text that is complete and the bytes of a character cut by the end of the chunk.
fn complete_text(bytes: &[u8]) -> (&str, &[u8]) {
    match std::str::from_utf8(bytes) {
        Ok(text) => (text, &[]),
        Err(error) if error.error_len().is_none() => {
            let (text, rest) = bytes.split_at(error.valid_up_to());

            (std::str::from_utf8(text).unwrap_or_default(), rest)
        }
        // * Bytes that are not text at all: shown with replacement characters, like any terminal.
        Err(_) => ("", bytes),
    }
}

impl Terminals {
    /// Starts a shell in `directory`; its output is sent as `terminal-data` events and `terminal-exit` ends it.
    pub fn open(
        &self,
        app: AppHandle,
        id: String,
        directory: &Path,
        columns: u16,
        rows: u16,
    ) -> Result<(), TerminalError> {
        check_id(&id)?;
        check_size(columns, rows)?;
        self.check_free(&id)?;

        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols: columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)?;
        let mut command = CommandBuilder::new(shell_program());

        command.cwd(directory);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        #[cfg(not(windows))]
        command.arg("-l");

        let child = pair.slave.spawn_command(command).map_err(pty_error)?;
        let mut reader = pair.master.try_clone_reader().map_err(pty_error)?;
        let writer = pair.master.take_writer().map_err(pty_error)?;
        let reader_id = id.clone();

        thread::spawn(move || {
            let mut buffer = [0u8; READ_CHUNK];
            let mut pending: Vec<u8> = Vec::new();

            while let Ok(read) = reader.read(&mut buffer) {
                if read == 0 {
                    break;
                }

                pending.extend_from_slice(&buffer[..read]);

                let (text, rest) = complete_text(&pending);
                let data = if text.is_empty() && !rest.is_empty() && rest.len() >= 4 {
                    String::from_utf8_lossy(rest).into_owned()
                } else {
                    text.to_string()
                };
                let keep = if data.is_empty() || text.is_empty() && rest.len() >= 4 {
                    Vec::new()
                } else {
                    rest.to_vec()
                };

                pending = keep;

                if !data.is_empty() {
                    let _ = app.emit(
                        "terminal-data",
                        TerminalData {
                            id: reader_id.clone(),
                            data,
                        },
                    );
                }
            }

            let _ = app.emit("terminal-exit", reader_id);
        });

        let mut sessions = self.sessions.lock().map_err(|_| TerminalError::Poisoned)?;

        // * Checked again under the lock: another open may have taken the id or the last slot while this shell started.
        if let Err(error) = Self::check_slot(&sessions, &id) {
            let mut child = child;
            let _ = child.kill();

            return Err(error);
        }

        sessions.insert(
            id,
            Session {
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
                child,
            },
        );

        Ok(())
    }

    fn check_free(&self, id: &str) -> Result<(), TerminalError> {
        let sessions = self.sessions.lock().map_err(|_| TerminalError::Poisoned)?;

        Self::check_slot(&sessions, id)
    }

    fn check_slot(sessions: &HashMap<String, Session>, id: &str) -> Result<(), TerminalError> {
        if sessions.contains_key(id) {
            Err(TerminalError::Exists)
        } else if sessions.len() >= MAX_SESSIONS {
            Err(TerminalError::TooMany)
        } else {
            Ok(())
        }
    }

    /// Sends what the user typed to the shell.
    pub fn write(&self, id: &str, data: &str) -> Result<(), TerminalError> {
        if data.len() > MAX_WRITE_BYTES {
            return Err(TerminalError::TooLarge);
        }

        // * Only this shell's writer is held while writing, so a shell that stops reading cannot block the other terminals.
        let writer = {
            let sessions = self.sessions.lock().map_err(|_| TerminalError::Poisoned)?;

            sessions
                .get(id)
                .ok_or_else(|| TerminalError::Unknown(id.to_string()))?
                .writer
                .clone()
        };
        let mut writer = writer.lock().map_err(|_| TerminalError::Poisoned)?;

        writer
            .write_all(data.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(pty_error)
    }

    /// Tells the shell the panel changed size.
    pub fn resize(&self, id: &str, columns: u16, rows: u16) -> Result<(), TerminalError> {
        check_size(columns, rows)?;

        let sessions = self.sessions.lock().map_err(|_| TerminalError::Poisoned)?;
        let session = sessions
            .get(id)
            .ok_or_else(|| TerminalError::Unknown(id.to_string()))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols: columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)
    }

    /// Ends the shell (a terminal that is already gone is not an error).
    pub fn close(&self, id: &str) -> Result<(), TerminalError> {
        let removed = self
            .sessions
            .lock()
            .map_err(|_| TerminalError::Poisoned)?
            .remove(id);

        if let Some(mut session) = removed {
            let _ = session.child.kill();
        }

        Ok(())
    }
}

#[cfg(test)]
#[path = "../tests/unit/terminal.rs"]
mod tests;
