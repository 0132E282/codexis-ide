//! The models an AI CLI offers. Codex keeps the list it fetched for the signed-in account in `models_cache.json`: that is the real list of what can be used. Claude has no list on disk, so the front end keeps its own.

use crate::{db, migrations};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

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

/// The Codex folder of an account: the `CODEX_HOME` its profile gives, else the default one.
pub fn codex_home_of(environment: &[(&'static str, String)]) -> Option<PathBuf> {
    environment
        .iter()
        .find(|(name, value)| *name == "CODEX_HOME" && !value.is_empty())
        .map(|(_, value)| PathBuf::from(value))
        .or_else(codex_home)
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

/// The models of each AI CLI, kept in the database when an account connects.
pub struct ModelStore {
    connection: Mutex<Connection>,
}

impl ModelStore {
    fn new(connection: Connection) -> rusqlite::Result<Self> {
        connection.execute_batch(migrations::CREATE_CLI_MODELS_TABLE)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Replaces the saved models of `cli` with `models`. An empty list changes nothing: a CLI that gave no list keeps the one it had.
    ///
    /// # Errors
    /// Fails when the rows cannot be written.
    pub fn replace(&self, cli: &str, models: &[ModelOption]) -> rusqlite::Result<()> {
        if models.is_empty() {
            return Ok(());
        }

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        let transaction = connection.transaction()?;

        transaction.execute("DELETE FROM cli_models WHERE cli = ?1", params![cli])?;

        for (position, model) in models.iter().enumerate() {
            transaction.execute(
                "INSERT OR REPLACE INTO cli_models (cli, value, label, position, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![cli, model.value, model.label, position, now],
            )?;
        }

        transaction.commit()
    }

    /// The saved models of `cli`, in the CLI's own order.
    ///
    /// # Errors
    /// Fails when the rows cannot be read.
    pub fn list(&self, cli: &str) -> rusqlite::Result<Vec<ModelOption>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let mut statement = connection
            .prepare("SELECT value, label FROM cli_models WHERE cli = ?1 ORDER BY position")?;

        statement
            .query_map(params![cli], |row| {
                Ok(ModelOption {
                    value: row.get(0)?,
                    label: row.get(1)?,
                })
            })?
            .collect()
    }
}

/// Called once at start-up with the database path: creates the table and manages the store.
///
/// # Errors
/// Fails when the table cannot be created.
pub fn setup(app: &tauri::App, database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let connection = db::open(database).unwrap_or_else(|_| db::in_memory());

    app.manage(ModelStore::new(connection)?);

    Ok(())
}

#[cfg(test)]
#[path = "../tests/unit/models.rs"]
mod tests;
