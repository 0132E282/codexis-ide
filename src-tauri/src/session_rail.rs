//! Data of the session rail (`docs/system/session-rail.md`): what the rail shows that the other modules do not already give.
//! Everything here only reads: the files the AI wrote (from the saved steps of a chat), the GitHub repository of the project and its pull request.
//! Pure functions parse text (tested in `tests/unit/session_rail.rs`); the commands in `commands/session_rail.rs` run the processes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

/// Tools of the Claude CLI that write a file; the step's `input` is the path they work on.
const WRITE_TOOLS: [&str; 4] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
/// Most files the rail lists.
pub const MAX_OUTPUTS: usize = 100;

/// A file the AI created or changed during the conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFile {
    /// Relative to the project root, usable with the viewer.
    pub path: String,
    /// The tool that touched it last (`Write`, `Edit`...).
    pub tool: String,
}

#[derive(Debug, Deserialize)]
struct StepRecord {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    input: Value,
}

/// `path` as a clean path relative to `root`: an absolute path must lie inside the root; anything that climbs out or that the deny list hides is dropped.
fn relative_to_root(path: &str, root: &Path) -> Option<String> {
    let relative = match Path::new(path).strip_prefix(root) {
        Ok(inside) => inside.to_str()?.to_string(),
        Err(_) if path.starts_with('/') => return None,
        Err(_) => path.to_string(),
    };
    let clean = crate::workspace::normalise(&relative)?;

    (!crate::workspace::denied(&clean)).then_some(clean)
}

/// The files the AI wrote in the saved `steps` (one JSON array per turn, oldest turn first), each once, the most recently touched first.
/// `exists` keeps out files that are gone now. A turn whose steps are not valid JSON is skipped, never an error.
pub fn output_files(
    turns: &[String],
    root: &Path,
    exists: impl Fn(&str) -> bool,
) -> Vec<OutputFile> {
    let mut touched: Vec<OutputFile> = Vec::new();

    for turn in turns {
        let Ok(steps) = serde_json::from_str::<Vec<StepRecord>>(turn) else {
            continue;
        };

        for step in steps {
            if step.kind != "tool" || !WRITE_TOOLS.contains(&step.name.as_str()) {
                continue;
            }

            let Some(path) = step
                .input
                .as_str()
                .and_then(|input| relative_to_root(input, root))
            else {
                continue;
            };

            touched.retain(|file| file.path != path);
            touched.push(OutputFile {
                path,
                tool: step.name,
            });
        }
    }

    touched.reverse();
    touched.retain(|file| exists(&file.path));
    touched.truncate(MAX_OUTPUTS);

    touched
}

/// Estimated tokens: one token is about this many characters (the CLI reports no token count for the text itself).
const CHARACTERS_PER_TOKEN: i64 = 4;

/// Tokens estimated from a count of characters.
pub fn estimate_tokens(characters: i64) -> i64 {
    characters.max(0) / CHARACTERS_PER_TOKEN
}

/// `path` with the home folder written as `~`, as the rail shows the folder.
pub fn shorten_home(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Some(rest) => format!("~/{}", rest.display()),
        None => path.display().to_string(),
    }
}

/// A repository on github.com, without any credential of the URL it came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoRef {
    pub owner: String,
    pub name: String,
    pub url: String,
}

fn name_part(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && !value.starts_with('.')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// The GitHub repository named by an `origin` URL (`https://`, `ssh://git@` or `git@github.com:`); None for another host or an odd URL.
pub fn parse_github_remote(url: &str) -> Option<RepoRef> {
    let url = url.trim();
    let path = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest
    } else {
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("ssh://"))?;
        // * `user:token@` in front of the host is dropped, never shown.
        let rest = rest.rsplit_once('@').map_or(rest, |(_, host)| host);

        rest.strip_prefix("github.com/")?
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;

    (name_part(owner) && name_part(name)).then(|| RepoRef {
        owner: owner.to_string(),
        name: name.to_string(),
        url: format!("https://github.com/{owner}/{name}"),
    })
}

/// An open pull request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
}

/// The first pull request of the JSON `gh pr list --json number,title,url` prints; None when the list is empty or is not that JSON.
/// Only `https://github.com/` links are kept, so the rail never opens another address.
pub fn parse_pull_request(json: &str) -> Option<PullRequest> {
    serde_json::from_str::<Vec<PullRequest>>(json)
        .ok()?
        .into_iter()
        .next()
        .filter(|pull| pull.url.starts_with("https://github.com/"))
}

/// How far the GitHub block got.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubStatus {
    Ok,
    NoCli,
    SignedOut,
    NoRemote,
}

#[cfg(test)]
#[path = "../tests/unit/session_rail.rs"]
mod tests;
