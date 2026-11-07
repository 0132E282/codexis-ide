//! Hand-off to VS Code: opens the project folder, or one file at a line, in the editor the person already uses.
//! Opens in a new window (one already showing this folder is just focused),
//! so the person's other VS Code windows are left alone.
//! Only allowed files are handed over (same guards as reading them).

use crate::workspace::{Workspace, WorkspaceError};
use std::path::Path;
use std::process::Command;

/// Where the `code` launcher sits on macOS when it was not added to PATH.
const MAC_LAUNCHER: &str = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";

/// Arguments of `code`: the folder, plus `--goto file:line` for a file.
pub fn args(root: &Path, file: Option<(&Path, u32)>) -> Vec<String> {
    let mut args = vec!["--new-window".to_string(), root.display().to_string()];

    if let Some((file, line)) = file {
        args.push("--goto".to_string());
        args.push(format!("{}:{}", file.display(), line.max(1)));
    }

    args
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenError {
    Workspace(WorkspaceError),
    /// Neither `code` on PATH nor the macOS app could be started.
    NotInstalled,
}

impl OpenError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::Workspace(error) => error.message(),
            Self::NotInstalled => "vscode.not_installed",
        }
    }
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for OpenError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Workspace(error) => Some(error),
            Self::NotInstalled => None,
        }
    }
}

impl From<WorkspaceError> for OpenError {
    fn from(error: WorkspaceError) -> Self {
        Self::Workspace(error)
    }
}

/// Opens the project (no `path`) or one file of it (at `line`) in VS Code.
pub fn open(workspace: &Workspace, path: Option<&str>, line: u32) -> Result<(), OpenError> {
    let file = path.map(|path| workspace.existing_path(path)).transpose()?;
    let launch_args = args(workspace.root(), file.as_deref().map(|file| (file, line)));

    for launcher in ["code", MAC_LAUNCHER] {
        if Command::new(launcher).args(&launch_args).spawn().is_ok() {
            return Ok(());
        }
    }

    Err(OpenError::NotInstalled)
}

#[cfg(test)]
#[path = "../tests/unit/vscode.rs"]
mod tests;
