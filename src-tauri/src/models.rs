//! The models an AI CLI offers, as its own `/model` command lists them. Codex keeps the list it fetched for the signed-in account in `models_cache.json`; Claude answers `claude -p "/model"` with the aliases it accepts.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// A model the CLI accepts for `-m`: `value` is what is passed, `label` what is shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelOption {
    pub value: String,
    pub label: String,
}

/// The folder Codex keeps its state in: `CODEX_HOME`, else `~/.codex`.
pub fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .filter(|home| !home.is_empty())
                .map(|home| PathBuf::from(home).join(".codex"))
        })
}

/// The models Codex lists for this account, in its own order; hidden ones (internal review models) are left out. Empty when the cache is missing or unreadable.
pub fn codex_models(codex_home: &Path) -> Vec<ModelOption> {
    let Ok(text) = fs::read_to_string(codex_home.join("models_cache.json")) else {
        return Vec::new();
    };
    let Ok(cache) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let mut listed: Vec<(u64, ModelOption)> = cache
        .get("models")
        .and_then(|models| models.as_array())
        .into_iter()
        .flatten()
        .filter(|model| {
            model
                .get("visibility")
                .and_then(|visibility| visibility.as_str())
                .is_none_or(|visibility| visibility == "list")
        })
        .filter_map(|model| {
            let slug = model.get("slug")?.as_str()?;
            let label = model
                .get("display_name")
                .and_then(|name| name.as_str())
                .unwrap_or(slug);
            let priority = model
                .get("priority")
                .and_then(|priority| priority.as_u64())
                .unwrap_or(u64::MAX);

            Some((
                priority,
                ModelOption {
                    value: slug.to_string(),
                    label: label.to_string(),
                },
            ))
        })
        .collect();

    listed.sort_by_key(|(priority, _)| *priority);

    listed.into_iter().map(|(_, option)| option).collect()
}

/// The aliases Claude lists after `Available:` in its answer to `/model` (the `or a full model ID` tail is not an alias).
pub fn parse_claude_models(output: &str) -> Vec<ModelOption> {
    let Some((_, list)) = output.split_once("Available:") else {
        return Vec::new();
    };

    list.lines()
        .next()
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|alias| !alias.is_empty() && !alias.starts_with("or "))
        .map(|alias| ModelOption {
            value: alias.to_string(),
            label: alias_label(alias),
        })
        .collect()
}

/// `sonnet[1m]` shown as `Sonnet (1M)`, `opus` as `Opus`.
fn alias_label(alias: &str) -> String {
    let (name, window) = match alias.split_once('[') {
        Some((name, rest)) => (name, Some(rest.trim_end_matches(']').to_uppercase())),
        None => (alias, None),
    };
    let mut letters = name.chars();
    let title: String = letters
        .next()
        .map(|first| first.to_uppercase().chain(letters).collect())
        .unwrap_or_default();

    match window {
        Some(window) => format!("{title} ({window})"),
        None => title,
    }
}

/// Asks the Claude CLI `/model` (answered by the CLI itself, nothing is sent to the model) and returns the aliases it lists; empty when it cannot be run or answers differently.
pub fn claude_models(program: &Path, environment: &[(&str, String)]) -> Vec<ModelOption> {
    let mut command: Command = crate::cli::command(program, environment);

    command
        .args(["-p", "/model"])
        .current_dir(std::env::temp_dir());

    command
        .output()
        .map(|output| parse_claude_models(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "../tests/unit/models.rs"]
mod tests;
