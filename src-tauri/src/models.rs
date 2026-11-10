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

/// Whether a `models_cache.json` entry is a model an agent can code with: listed (not hidden), usable through the API, reads text, and with a shell tool (embedding, audio, image or moderation models lack these). A field the entry does not carry does not exclude it.
fn is_coding_model(model: &serde_json::Value) -> bool {
    let is_listed = model
        .get("visibility")
        .and_then(|visibility| visibility.as_str())
        .is_none_or(|visibility| visibility == "list");
    let is_supported_in_api = model
        .get("supported_in_api")
        .and_then(|supported| supported.as_bool())
        .unwrap_or(true);
    let reads_text = model
        .get("input_modalities")
        .and_then(|modalities| modalities.as_array())
        .is_none_or(|modalities| modalities.iter().any(|kind| kind == "text"));
    let has_shell = model
        .get("shell_type")
        .and_then(|shell| shell.as_str())
        .is_none_or(|shell| shell != "disabled");

    is_listed && is_supported_in_api && reads_text && has_shell
}

/// The models Codex lists for this account that can code (see `is_coding_model`), in its own order. Empty when the cache is missing or unreadable.
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
        .filter(|model| is_coding_model(model))
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

/// The version each Claude alias points to. `claude -p "/model"` only names the current model, not what every alias resolves to, so this is the one place to update when Anthropic moves an alias (Fable `claude-fable-5-1`, Opus `claude-opus-5-5`, Sonnet `claude-sonnet-5-5`, Haiku `claude-haiku-5-5`). Aliases without a fixed version (`best`, `opusplan`, `default`) are not listed.
const CLAUDE_ALIAS_VERSIONS: [(&str, &str); 4] = [
    ("fable", "5.1"),
    ("opus", "5.5"),
    ("sonnet", "5.5"),
    ("haiku", "5.5"),
];

/// `sonnet[1m]` shown as `Sonnet 5.5 (1M)`, `opus` as `Opus 5.5`, `best` as `Best`; only the label changes, the alias stays the value sent to the CLI.
fn alias_label(alias: &str) -> String {
    let (name, window) = match alias.split_once('[') {
        Some((name, rest)) => (name, Some(rest.trim_end_matches(']').to_uppercase())),
        None => (alias, None),
    };
    let mut letters = name.chars();
    let mut title: String = letters
        .next()
        .map(|first| first.to_uppercase().chain(letters).collect())
        .unwrap_or_default();

    if let Some((_, version)) = CLAUDE_ALIAS_VERSIONS
        .iter()
        .find(|(known, _)| *known == name)
    {
        title = format!("{title} {version}");
    }

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

/// The lines of `agy models` (`<value>\t<label>` after a `Fetching…` line): every model it lists is an agent model, so all are kept.
pub fn parse_antigravity_models(output: &str) -> Vec<ModelOption> {
    output
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .filter(|(value, label)| !value.trim().is_empty() && !label.trim().is_empty())
        .map(|(value, label)| ModelOption {
            value: value.trim().to_string(),
            label: label.trim().to_string(),
        })
        .collect()
}

/// Asks `agy models`; empty when the CLI is signed out (it exits with an error) or cannot be run.
pub fn antigravity_models(program: &Path, environment: &[(&str, String)]) -> Vec<ModelOption> {
    crate::cli::command(program, environment)
        .arg("models")
        .current_dir(std::env::temp_dir())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| parse_antigravity_models(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "../tests/unit/models.rs"]
mod tests;
