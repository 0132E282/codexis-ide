//! API keys the user chose to keep in Rynox, in their own table of the IDE's SQLite file (owner-only, see `db`).
//! A key is write-only for the UI: it is never sent back, only whether it is set and its last characters. A turn with the CLI gets it as an environment variable.

use crate::sql;
use crate::validation;
use crate::{db, migrations};
use rusqlite::Connection;
use sea_query::{Alias, Condition, Expr, ExprTrait, Value};
use serde::Serialize;
use std::fmt;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Manager, State};

/// Names that can be saved; each maps to the environment variable the CLI reads.
pub const ANTHROPIC_API_KEY: &str = "anthropic_api_key";
const NAMES: [(&str, &str); 1] = [(ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY")];
const HINT_CHARS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialError {
    Invalid,
    SaveFailed,
    LoadFailed,
}

impl CredentialError {
    /// Fixed user-facing text; never contains the key.
    pub fn message(self) -> &'static str {
        match self {
            Self::Invalid => "credentials.invalid",
            Self::SaveFailed => "credentials.save_failed",
            Self::LoadFailed => "credentials.load_failed",
        }
    }
}

impl fmt::Display for CredentialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for CredentialError {}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CredentialStatus {
    pub name: &'static str,
    pub set: bool,
    /// Last characters of the saved key, enough to recognise it.
    pub hint: Option<String>,
}

pub struct CredentialStore {
    connection: Mutex<Connection>,
}

impl CredentialStore {
    fn new(connection: Connection) -> Result<Self, rusqlite::Error> {
        connection.execute_batch(migrations::CREATE_CREDENTIALS_TABLE)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn known(name: &str) -> Result<(), CredentialError> {
        NAMES
            .iter()
            .any(|(known, _)| *known == name)
            .then_some(())
            .ok_or(CredentialError::Invalid)
    }

    /// Saves (replaces) the key `name`; surrounding spaces are dropped.
    ///
    /// # Errors
    /// Fails on an unknown name, an empty, overlong value or one with a character outside printable ASCII (space included), or when it cannot be written.
    pub fn save(&self, name: &str, value: &str) -> Result<(), CredentialError> {
        Self::known(name)?;

        let value = value.trim();

        validation::api_key(value).map_err(|_| CredentialError::Invalid)?;

        let connection = self
            .connection
            .lock()
            .map_err(|_| CredentialError::SaveFailed)?;

        sql::upsert(
            &connection,
            "credentials",
            &["name"],
            vec![("name", Value::from(name)), ("value", Value::from(value))],
        )
        .map_err(|_| CredentialError::SaveFailed)?;

        Ok(())
    }

    /// Forgets the key `name`.
    ///
    /// # Errors
    /// Fails on an unknown name or when the row cannot be removed.
    pub fn remove(&self, name: &str) -> Result<(), CredentialError> {
        Self::known(name)?;

        let connection = self
            .connection
            .lock()
            .map_err(|_| CredentialError::SaveFailed)?;

        sql::delete_where(
            &connection,
            "credentials",
            Condition::all().add(Expr::col(Alias::new("name")).eq(name)),
        )
        .map_err(|_| CredentialError::SaveFailed)?;

        Ok(())
    }

    fn get(&self, name: &str) -> Result<Option<String>, CredentialError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CredentialError::LoadFailed)?;

        sql::find_by_key(
            &connection,
            "credentials",
            &["value"],
            "name",
            name,
            |row| row.get(0),
        )
        .map_err(|_| CredentialError::LoadFailed)
    }

    /// Whether each key is set, with its last characters.
    ///
    /// # Errors
    /// Fails when the table cannot be read.
    pub fn status(&self) -> Result<Vec<CredentialStatus>, CredentialError> {
        NAMES
            .iter()
            .map(|(name, _)| {
                let value = self.get(name)?;

                Ok(CredentialStatus {
                    name,
                    set: value.is_some(),
                    hint: value.map(|key| {
                        let skip = key.chars().count().saturating_sub(HINT_CHARS);

                        key.chars().skip(skip).collect()
                    }),
                })
            })
            .collect()
    }

    /// Environment variables for a turn: every saved key under the name the CLI reads. A read failure gives none, so the CLI falls back to its own login.
    pub fn environment(&self) -> Vec<(&'static str, String)> {
        NAMES
            .iter()
            .filter_map(|(name, variable)| {
                self.get(name)
                    .ok()
                    .flatten()
                    .map(|value| (*variable, value))
            })
            .collect()
    }
}

/// Called once at start-up with the database path.
///
/// # Errors
/// Fails when the table cannot be created.
pub fn setup(app: &tauri::App, database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let connection = db::open(database).unwrap_or_else(|_| db::in_memory());

    app.manage(CredentialStore::new(connection)?);

    Ok(())
}

#[tauri::command]
pub fn credential_status(store: State<CredentialStore>) -> Result<Vec<CredentialStatus>, String> {
    store.status().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn credential_save(
    store: State<CredentialStore>,
    name: String,
    value: String,
) -> Result<Vec<CredentialStatus>, String> {
    store
        .save(&name, &value)
        .map_err(|error| error.to_string())?;

    store.status().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn credential_remove(
    store: State<CredentialStore>,
    name: String,
) -> Result<Vec<CredentialStatus>, String> {
    store.remove(&name).map_err(|error| error.to_string())?;

    store.status().map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "../tests/unit/credentials.rs"]
mod tests;
