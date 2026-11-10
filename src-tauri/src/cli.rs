//! Identity of the external CLIs Rynox drives (`claude`, `codex`, `gemini`, `gh`): the one place that knows their names, programs and where to find them.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Environment that points a CLI at one of its profile folders; empty = the CLI's own login.
pub type Environment = Vec<(&'static str, String)>;

/// Folders searched after `PATH`: a desktop app does not inherit the shell's `PATH`, so the usual install places are tried as well.
const EXTRA_BIN_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", ".local/bin"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CliKind {
    Claude,
    Codex,
    Gemini,
    Github,
}

impl CliKind {
    /// Every CLI, in the order used for listings and statistics.
    pub const ALL: [CliKind; 4] = [
        CliKind::Claude,
        CliKind::Codex,
        CliKind::Gemini,
        CliKind::Github,
    ];

    /// The CLIs that can run a chat turn (Gemini is only connected for now, it does not chat yet).
    pub const AGENTS: [CliKind; 2] = [CliKind::Claude, CliKind::Codex];

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            "github" => Some(Self::Github),
            _ => None,
        }
    }

    /// Like [`CliKind::parse`], but only for the CLIs that can chat.
    pub fn parse_agent(name: &str) -> Option<Self> {
        Self::parse(name).filter(|kind| Self::AGENTS.contains(kind))
    }

    /// Name used in the database, in profiles and in `ProviderStatus.provider`.
    pub fn name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Github => "github",
        }
    }

    /// Executable that is run.
    pub fn program(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Github => "gh",
        }
    }

    /// Environment variable that points the CLI at a profile folder.
    pub fn config_variable(self) -> &'static str {
        match self {
            Self::Claude => "CLAUDE_CONFIG_DIR",
            Self::Codex => "CODEX_HOME",
            // * Not the `.gemini` folder itself: the CLI puts `.gemini` inside this home.
            Self::Gemini => "GEMINI_CLI_HOME",
            Self::Github => "GH_CONFIG_DIR",
        }
    }
}

/// `PATH` with the usual install folders added at the end, for a program that starts others by name (a `node` script's `env node`): a desktop app does not inherit the shell's `PATH`.
pub fn search_path() -> std::ffi::OsString {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let extra = EXTRA_BIN_DIRS.iter().map(|dir| match &home {
        Some(home) if !dir.starts_with('/') => home.join(dir),
        _ => PathBuf::from(dir),
    });

    std::env::join_paths(std::env::split_paths(&path).chain(extra)).unwrap_or(path)
}

/// Full path of the CLI, searched in `PATH` first and then in the usual install folders.
pub fn locate(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let extra = EXTRA_BIN_DIRS.iter().map(|dir| match &home {
        Some(home) if !dir.starts_with('/') => home.join(dir),
        _ => PathBuf::from(dir),
    });

    std::env::split_paths(&path)
        .chain(extra)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

/// A command for `program` with `environment` set and no stdin; callers change stdin/stdout when they need to.
pub fn command(program: &Path, environment: &[(&str, String)]) -> Command {
    let mut command = Command::new(program);
    command
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::null());
    command
}

#[cfg(test)]
#[path = "../tests/unit/cli.rs"]
mod tests;
