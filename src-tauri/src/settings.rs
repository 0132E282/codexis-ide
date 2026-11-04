//! Chat settings: assistant avatar and names, custom instructions, advanced options.
//!
//! Kept as one JSON row (`settings.key = 'chat'`) in the IDE's SQLite file. The avatar is a small image data URL inside that row.

use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Manager, State};

const KEY: &str = "chat";
const MAX_NAME_CHARS: usize = 60;
const MAX_INSTRUCTIONS_CHARS: usize = 8000;
const MAX_VOICE_CHARS: usize = 200;
const MAX_MODEL_CHARS: usize = 100;
/// Largest avatar data URL (the front end shrinks the picture first).
pub const MAX_AVATAR_BYTES: usize = 300_000;
/// Subscription plans a CLI can be marked with; empty = not chosen. Only shown in the statistics, never sent anywhere.
const CLAUDE_PLANS: [&str; 5] = ["", "free", "pro", "max5", "max20"];
const CODEX_PLANS: [&str; 4] = ["", "free", "plus", "pro"];
const AVATAR_PREFIXES: [&str; 4] = [
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
    "data:image/gif;base64,",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsError {
    Invalid,
    SaveFailed,
    LoadFailed,
}

impl SettingsError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::Invalid => "Cài đặt không hợp lệ.",
            Self::SaveFailed => "Không lưu được cài đặt.",
            Self::LoadFailed => "Không đọc được cài đặt đã lưu.",
        }
    }
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for SettingsError {}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChatSettings {
    /// Data URL of the assistant's picture; empty = default avatar.
    pub avatar: String,
    /// What the AI calls the person; empty = no name.
    pub user_name: String,
    pub assistant_name: String,
    /// Name of the device voice that reads answers; empty = system default.
    pub voice: String,
    pub custom_instructions: String,
    /// `claude`, `codex` or empty (ask each time).
    pub default_cli: String,
    pub claude_model: String,
    pub codex_model: String,
    /// Subscription plan of each CLI, shown in the statistics; empty = not chosen.
    pub claude_plan: String,
    pub codex_plan: String,
    /// When a CLI runs out of its allowance, the chat moves on to the next one in `fallback_order`.
    pub fallback_enabled: bool,
    /// CLIs (`claude`, `codex`) in the order they are tried.
    pub fallback_order: Vec<String>,
}

impl ChatSettings {
    fn validate(&self) -> Result<(), SettingsError> {
        let avatar_ok = self.avatar.is_empty()
            || (self.avatar.len() <= MAX_AVATAR_BYTES
                && AVATAR_PREFIXES
                    .iter()
                    .any(|prefix| self.avatar.starts_with(prefix)));
        let cli_ok = matches!(self.default_cli.as_str(), "" | "claude" | "codex");
        let plans_ok = CLAUDE_PLANS.contains(&self.claude_plan.as_str())
            && CODEX_PLANS.contains(&self.codex_plan.as_str());
        let order_ok = self.fallback_order.len() <= 2
            && self.fallback_order.iter().enumerate().all(|(index, cli)| {
                matches!(cli.as_str(), "claude" | "codex")
                    && !self.fallback_order[..index].contains(cli)
            });
        let lengths_ok = self.user_name.chars().count() <= MAX_NAME_CHARS
            && self.assistant_name.chars().count() <= MAX_NAME_CHARS
            && self.voice.chars().count() <= MAX_VOICE_CHARS
            && self.custom_instructions.chars().count() <= MAX_INSTRUCTIONS_CHARS
            && self.claude_model.chars().count() <= MAX_MODEL_CHARS
            && self.codex_model.chars().count() <= MAX_MODEL_CHARS;

        if avatar_ok && cli_ok && plans_ok && order_ok && lengths_ok {
            Ok(())
        } else {
            Err(SettingsError::Invalid)
        }
    }
}

pub struct SettingsStore {
    connection: Mutex<Connection>,
}

impl SettingsStore {
    fn new(connection: Connection) -> Result<Self, rusqlite::Error> {
        connection.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Saved settings, or the defaults when nothing was saved yet.
    ///
    /// # Errors
    /// Fails when the row cannot be read or is not valid JSON.
    pub fn get(&self) -> Result<ChatSettings, SettingsError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| SettingsError::LoadFailed)?;
        let value: Option<String> = connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| SettingsError::LoadFailed)?;

        value.map_or_else(
            || Ok(ChatSettings::default()),
            |json| serde_json::from_str(&json).map_err(|_| SettingsError::LoadFailed),
        )
    }

    /// Validates and replaces the saved settings.
    ///
    /// # Errors
    /// Fails on invalid values or when the row cannot be written.
    pub fn save(&self, settings: &ChatSettings) -> Result<(), SettingsError> {
        settings.validate()?;

        let json = serde_json::to_string(settings).map_err(|_| SettingsError::SaveFailed)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| SettingsError::SaveFailed)?;

        connection
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![KEY, json],
            )
            .map_err(|_| SettingsError::SaveFailed)?;

        Ok(())
    }
}

/// Called once at start-up with the database path: create the module's own tables and `app.manage(...)` its state here.
///
/// # Errors
/// Fails when the module cannot be set up.
pub fn setup(app: &tauri::App, database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let connection = db::open(database).unwrap_or_else(|_| db::in_memory());

    app.manage(SettingsStore::new(connection)?);

    Ok(())
}

#[tauri::command]
pub fn settings_get(store: State<SettingsStore>) -> Result<ChatSettings, String> {
    store.get().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn settings_save(
    store: State<SettingsStore>,
    settings: ChatSettings,
) -> Result<ChatSettings, String> {
    store.save(&settings).map_err(|error| error.to_string())?;

    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> SettingsStore {
        SettingsStore::new(db::in_memory()).expect("store")
    }

    #[test]
    fn defaults_when_nothing_saved() {
        assert_eq!(store().get().unwrap(), ChatSettings::default());
    }

    #[test]
    fn saves_and_replaces() {
        let store = store();
        let mut settings = ChatSettings {
            assistant_name: "Trợ lý".into(),
            default_cli: "claude".into(),
            avatar: "data:image/png;base64,AAAA".into(),
            ..ChatSettings::default()
        };

        store.save(&settings).unwrap();
        assert_eq!(store.get().unwrap(), settings);

        settings.assistant_name = "Khác".into();
        store.save(&settings).unwrap();
        assert_eq!(store.get().unwrap().assistant_name, "Khác");
    }

    #[test]
    fn rejects_invalid_values() {
        let store = store();
        let bad_avatar = ChatSettings {
            avatar: "https://example.com/a.png".into(),
            ..ChatSettings::default()
        };
        let big_avatar = ChatSettings {
            avatar: format!("data:image/png;base64,{}", "A".repeat(MAX_AVATAR_BYTES)),
            ..ChatSettings::default()
        };
        let bad_cli = ChatSettings {
            default_cli: "other".into(),
            ..ChatSettings::default()
        };
        let long_name = ChatSettings {
            user_name: "a".repeat(MAX_NAME_CHARS + 1),
            ..ChatSettings::default()
        };

        for settings in [bad_avatar, big_avatar, bad_cli, long_name] {
            assert_eq!(store.save(&settings), Err(SettingsError::Invalid));
        }
        assert_eq!(store.get().unwrap(), ChatSettings::default());
    }

    #[test]
    fn plans_must_be_known() {
        let store = store();
        let mut settings = ChatSettings {
            claude_plan: "max5".into(),
            codex_plan: "plus".into(),
            ..ChatSettings::default()
        };

        store.save(&settings).unwrap();
        assert_eq!(store.get().unwrap(), settings);

        settings.codex_plan = "max5".into();
        assert_eq!(store.save(&settings), Err(SettingsError::Invalid));
    }
}
