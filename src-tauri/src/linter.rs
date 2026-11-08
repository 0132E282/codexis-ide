//! Lint as you type: pipes a file's text through the project's own ESLint, so the problems follow its `eslint.config.js` like `pnpm lint` does.

use crate::cli::{locate, search_path};
use crate::workspace::{normalise, Workspace, MAX_WRITE_BYTES};
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// File types ESLint is asked to check.
const EXTENSIONS: &[&str] = &["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];

/// Most problems sent back for one file.
const MAX_MESSAGES: usize = 500;

/// How long one run may take before it is stopped.
const TIMEOUT: Duration = Duration::from_secs(20);

/// One problem ESLint found. Lines and columns start at 1, like ESLint's own report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LintMessage {
    /// The rule that reported it (none for a syntax error).
    pub rule: Option<String>,
    /// 1 is a warning, 2 an error.
    pub severity: u8,
    pub message: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

/// The problems ESLint finds in `text`, or none when the type is unsupported, ESLint is missing, the config is broken or the run is too slow (typing must never be blocked by linting).
pub fn lint(workspace: &Workspace, path: &str, text: &str) -> Vec<LintMessage> {
    try_lint(workspace, path, text).unwrap_or_default()
}

fn try_lint(workspace: &Workspace, path: &str, text: &str) -> Option<Vec<LintMessage>> {
    // * The same path and size rules as saving a file: anything the viewer could not write is not linted either.
    if text.len() > MAX_WRITE_BYTES {
        return None;
    }

    let clean = normalise(path)?;
    let relative = Path::new(&clean);
    let extension = relative.extension()?.to_str()?.to_ascii_lowercase();

    if !EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }

    let root = workspace.root();
    let mut child = Command::new(eslint(root)?)
        .current_dir(root)
        .env("PATH", search_path())
        .args(["--stdin", "--format", "json", "--stdin-filename"])
        .arg(root.join(relative))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // * Both pipes are served from their own threads: a large file or report must not fill a pipe while ESLint is still working.
    let mut stdin = child.stdin.take()?;
    let mut stdout = child.stdout.take()?;
    let input = text.to_string();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let reader = std::thread::spawn(move || {
        let mut report = String::new();

        stdout.read_to_string(&mut report).map(|_| report)
    });
    let deadline = Instant::now() + TIMEOUT;

    let status = loop {
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();

            return None;
        }

        std::thread::sleep(Duration::from_millis(20));
    };

    let _ = writer.join();
    let report = reader.join().ok()?.ok()?;

    // * 0: clean, 1: problems found; anything else (2) is ESLint failing to run, not a finding.
    match status.code()? {
        0 | 1 => Some(parse_report(&report)),
        _ => None,
    }
}

/// The problems of ESLint's JSON report (`--format json`): a list with one entry per file, each with its `messages`. A report that is not that gives none.
pub fn parse_report(report: &str) -> Vec<LintMessage> {
    let Ok(Value::Array(files)) = serde_json::from_str::<Value>(report) else {
        return Vec::new();
    };
    let number = |value: &Value, key: &str| value.get(key).and_then(Value::as_u64);

    files
        .iter()
        .filter_map(|file| file.get("messages")?.as_array())
        .flatten()
        // * A message without a position is about the file (for example "File ignored"), not a line of it.
        .filter_map(|message| {
            let line = u32::try_from(number(message, "line")?).ok()?;
            let column = u32::try_from(number(message, "column").unwrap_or(1)).ok()?;

            Some(LintMessage {
                rule: message
                    .get("ruleId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                severity: if number(message, "severity") == Some(2) {
                    2
                } else {
                    1
                },
                message: message.get("message")?.as_str()?.to_string(),
                line,
                column,
                end_line: number(message, "endLine")
                    .and_then(|value| u32::try_from(value).ok())
                    .unwrap_or(line),
                end_column: number(message, "endColumn")
                    .and_then(|value| u32::try_from(value).ok())
                    .unwrap_or(column + 1),
            })
        })
        .take(MAX_MESSAGES)
        .collect()
}

/// The project's own ESLint first (the version its config was written for), then one on the PATH.
fn eslint(root: &Path) -> Option<PathBuf> {
    let local = root.join("node_modules/.bin/eslint");

    if local.is_file() {
        Some(local)
    } else {
        locate("eslint")
    }
}

#[cfg(test)]
#[path = "../tests/unit/linter.rs"]
mod tests;
