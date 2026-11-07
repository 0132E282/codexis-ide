//! Which language servers are switched on, and where each one is taken from.
//!
//! Kept as one JSON row (`settings.key = 'language_servers'`) next to the chat settings in the IDE's SQLite file. Every server is off until the person turns it on: a server may run the project's build scripts.

use crate::language_server_catalog::{self as catalog, SourceChoice};
use crate::vscode_extensions;
use crate::{db, migrations, sql};
use rusqlite::Connection;
use sea_query::Value;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;

const KEY: &str = "language_servers";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigError {
    /// An unknown server, or an extension root that is not one of the fixed folders.
    Invalid,
    /// The id is not in the catalog.
    UnknownServer,
    SaveFailed,
}

impl ConfigError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::Invalid => "language_server.invalid",
            Self::UnknownServer => "language_server.unknown_server",
            Self::SaveFailed => "language_server.save_failed",
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ConfigError {}

/// The person's choice for one server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSetting {
    pub id: String,
    pub enabled: bool,
    pub source: SourceChoice,
    /// Only with `source = vscode`: the editor's extension folder to take the server from (one of the fixed roots).
    pub extension_root: Option<String>,
}

impl ServerSetting {
    fn default_for(id: &str) -> Self {
        Self {
            id: id.to_string(),
            enabled: false,
            source: SourceChoice::Auto,
            extension_root: None,
        }
    }
}

/// The row as written; read back leniently so one bad entry cannot lose the others.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    servers: Vec<StoredServer>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct StoredServer {
    id: String,
    enabled: bool,
    source: String,
    extension_root: Option<String>,
}

impl StoredServer {
    /// `None` for an unknown server or source; an unknown extension root is dropped, the rest kept.
    fn sanitized(self) -> Option<ServerSetting> {
        catalog::spec(&self.id)?;

        let source: SourceChoice =
            serde_json::from_value(serde_json::Value::String(self.source)).ok()?;
        let extension_root = self
            .extension_root
            .filter(|root| vscode_extensions::ExtensionOrigin::parse(root).is_some())
            .filter(|_| source == SourceChoice::Vscode);

        Some(ServerSetting {
            id: self.id,
            enabled: self.enabled,
            source,
            extension_root,
        })
    }
}

/// The settings are read on every keystroke of an open file (the editor asks whether a server is on), so the last answer is kept in memory. `save` is the only writer of the row and drops the kept answer; every clone of the store shares both.
#[derive(Clone)]
pub struct LanguageServerConfigStore {
    connection: Arc<Mutex<Connection>>,
    cache: Arc<Mutex<Option<Vec<ServerSetting>>>>,
}

impl LanguageServerConfigStore {
    fn new(connection: Connection) -> Result<Self, rusqlite::Error> {
        connection.execute_batch(migrations::CREATE_SETTINGS_TABLE)?;

        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            cache: Arc::new(Mutex::new(None)),
        })
    }

    /// The setting of every known server, in catalog order; a server never saved, or a row that cannot be read, is off with the automatic source.
    pub fn get(&self) -> Vec<ServerSetting> {
        // * Held while the row is read, so a `save` cannot slip in between the read and the store and leave an old answer behind.
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if let Some(settings) = cache.as_ref() {
            return settings.clone();
        }

        let (stored, trustworthy) = self.read();
        let settings: Vec<ServerSetting> = catalog::SERVERS
            .iter()
            .map(|spec| {
                stored
                    .iter()
                    .find(|setting| setting.id == spec.id)
                    .cloned()
                    .unwrap_or_else(|| ServerSetting::default_for(spec.id))
            })
            .collect();

        // * A failed read (database busy or unreachable) is not kept: the next call asks again.
        if trustworthy {
            *cache = Some(settings.clone());
        }

        settings
    }

    /// The setting of one known server.
    pub fn setting(&self, id: &str) -> Option<ServerSetting> {
        self.get().into_iter().find(|setting| setting.id == id)
    }

    /// The saved settings, and whether the answer can be kept: false when the database could not be asked, true for a row that is absent or damaged (that stays so until the next save).
    fn read(&self) -> (Vec<ServerSetting>, bool) {
        let Ok(connection) = self.connection.lock() else {
            return (Vec::new(), false);
        };
        let json = match sql::find_by_key(&connection, "settings", &["value"], "key", KEY, |row| {
            row.get::<_, String>(0)
        }) {
            Ok(Some(json)) => json,
            Ok(None) => return (Vec::new(), true),
            Err(_) => return (Vec::new(), false),
        };
        let Ok(stored) = serde_json::from_str::<Stored>(&json) else {
            return (Vec::new(), true);
        };
        let mut settings: Vec<ServerSetting> = Vec::new();

        for setting in stored
            .servers
            .into_iter()
            .filter_map(StoredServer::sanitized)
        {
            if !settings.iter().any(|known| known.id == setting.id) {
                settings.push(setting);
            }
        }

        (settings, true)
    }

    /// Saves the choice for one server and returns it as stored.
    ///
    /// # Errors
    /// Fails for an unknown server or extension root, and when the row cannot be written.
    pub fn save(
        &self,
        id: &str,
        enabled: bool,
        source: SourceChoice,
        extension_root: Option<&str>,
    ) -> Result<ServerSetting, ConfigError> {
        catalog::spec(id).ok_or(ConfigError::UnknownServer)?;

        if extension_root
            .is_some_and(|root| vscode_extensions::ExtensionOrigin::parse(root).is_none())
        {
            return Err(ConfigError::Invalid);
        }

        let saved = ServerSetting {
            id: id.to_string(),
            enabled,
            source,
            extension_root: extension_root
                .filter(|_| source == SourceChoice::Vscode)
                .map(str::to_string),
        };
        let mut servers = self.get();

        if let Some(slot) = servers.iter_mut().find(|setting| setting.id == id) {
            *slot = saved.clone();
        }

        let json = serde_json::to_string(&Stored {
            servers: servers
                .into_iter()
                .map(|setting| StoredServer {
                    id: setting.id,
                    enabled: setting.enabled,
                    source: serde_json::to_value(setting.source)
                        .ok()
                        .and_then(|value| value.as_str().map(str::to_string))
                        .unwrap_or_default(),
                    extension_root: setting.extension_root,
                })
                .collect(),
        })
        .map_err(|_| ConfigError::SaveFailed)?;
        // * Cache first, then connection: the same order `get` uses. The kept answer is dropped even when the write fails, so the next read tells the truth.
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = self
            .connection
            .lock()
            .map_err(|_| ConfigError::SaveFailed)?;

        *cache = None;

        sql::upsert(
            &connection,
            "settings",
            &["key"],
            vec![("key", Value::from(KEY)), ("value", Value::from(json))],
        )
        .map_err(|_| ConfigError::SaveFailed)?;

        Ok(saved)
    }
}

/// Called once at start-up with the database path: `app.manage(...)` the store.
///
/// Registers the store with the app and returns a handle for the event sink.
///
/// # Errors
/// Fails when the table cannot be created.
pub fn setup(
    app: &tauri::App,
    database: &Path,
) -> Result<LanguageServerConfigStore, Box<dyn std::error::Error>> {
    let connection = db::open(database).unwrap_or_else(|_| db::in_memory());
    let store = LanguageServerConfigStore::new(connection)?;

    app.manage(store.clone());

    Ok(store)
}

#[cfg(test)]
#[path = "../tests/unit/language_server_config.rs"]
mod tests;
