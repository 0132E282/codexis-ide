//! Format-on-save: pipes a file's text through the project's own Prettier, so it follows the project's `.prettierrc` like `pnpm format` does.

use crate::cli::locate;
use crate::workspace::{normalise, Workspace, MAX_WRITE_BYTES};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// File types Prettier is asked to format.
const EXTENSIONS: &[&str] = &[
    "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "json", "css", "md", "html",
];

/// The text formatted by Prettier, or the text unchanged when the type is unsupported, Prettier is missing or the code has a syntax error (saving must never be blocked by formatting).
pub fn format(workspace: &Workspace, path: &str, text: &str) -> String {
    try_format(workspace, path, text).unwrap_or_else(|| text.to_string())
}

fn try_format(workspace: &Workspace, path: &str, text: &str) -> Option<String> {
    // * The same path and size rules as saving a file: anything the viewer could not write is not formatted either.
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
    let mut child = Command::new(prettier(root)?)
        .current_dir(root)
        .arg("--stdin-filepath")
        .arg(root.join(relative))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // * Written from its own thread: a large file must not fill the pipe while Prettier is still writing its answer.
    let mut stdin = child.stdin.take()?;
    let input = text.to_string();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let output = child.wait_with_output().ok()?;

    writer.join().ok()?.ok()?;

    if output.status.success() {
        String::from_utf8(output.stdout).ok()
    } else {
        None
    }
}

/// The project's own Prettier first (the version its config was written for), then one on the PATH.
fn prettier(root: &Path) -> Option<PathBuf> {
    let local = root.join("node_modules/.bin/prettier");

    if local.is_file() {
        Some(local)
    } else {
        locate("prettier")
    }
}

#[cfg(test)]
#[path = "../tests/unit/formatter.rs"]
mod tests;
