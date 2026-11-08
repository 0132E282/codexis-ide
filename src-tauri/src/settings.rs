//! Chat settings: assistant avatar and names, custom instructions, advanced options.
//!
//! Kept as one JSON row (`settings.key = 'chat'`) in the IDE's SQLite file. The avatar is a small image data URL inside that row.

use crate::cli::CliKind;
use crate::speech;
use crate::sql;
use crate::validation;
use crate::{db, migrations};
use rusqlite::Connection;
use sea_query::Value;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Manager, State};

const KEY: &str = "chat";
const MAX_NAME_CHARS: usize = 60;
const MAX_INSTRUCTIONS_CHARS: usize = 8000;
const MAX_VOICE_CHARS: usize = 200;
const MAX_URL_CHARS: usize = 200;
/// Largest `storageWarnMultiplier`.
pub const MAX_WARN_MULTIPLIER: u32 = 100;
/// Slowest and fastest reading speed, in percent.
pub const MIN_VOICE_RATE: u32 = 80;
pub const MAX_VOICE_RATE: u32 = 125;
/// Largest avatar data URL (the front end shrinks the picture first).
pub const MAX_AVATAR_BYTES: usize = validation::MAX_AVATAR_DATA_URL_BYTES;
/// Subscription plans a CLI can be marked with; empty = not chosen. Only shown in the statistics, never sent anywhere.
const CLAUDE_PLANS: [&str; 5] = ["", "free", "pro", "max5", "max20"];
const CODEX_PLANS: [&str; 4] = ["", "free", "plus", "pro"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsError {
    Invalid,
    /// A field failed a shared rule; carries its `validation.*` key.
    Rejected(&'static str),
    SaveFailed,
    LoadFailed,
}

impl SettingsError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::Invalid => "settings.invalid",
            Self::Rejected(key) => key,
            Self::SaveFailed => "settings.save_failed",
            Self::LoadFailed => "settings.load_failed",
        }
    }
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for SettingsError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
    /// Language of the interface: `vi`, `en` or empty (not chosen yet).
    pub language: String,
    /// Look of the interface: `system`, `light`, `dark` or empty (follow the system).
    pub appearance: String,
    /// Colors of the code in the editor: `auto` (follow the interface), `light`, `dark` or empty (auto); the two `-colorblind` schemes avoid red/green pairs.
    pub code_colors: String,
    /// Who reads answers aloud: `system` (the device voice), `vieneu` (a local VieNeu-TTS server) or empty (system).
    pub voice_engine: String,
    /// Loopback `http://` address of the VieNeu-TTS server; empty = `http://127.0.0.1:8000`.
    pub vieneu_url: String,
    /// VieNeu-TTS voice id; empty = the server's default.
    pub vieneu_voice: String,
    /// Reading speed in percent (80 to 125); 0 = not chosen (100).
    pub voice_rate: u32,
    /// Plans the AI writes in the chat are also saved as files in the project (`plans_dir`); off by default, nothing is written to the project folder otherwise.
    pub save_plans_to_project: bool,
    /// Folder of the saved plans, relative to the project and inside it; empty = `docs/plans`.
    pub plans_dir: String,
    /// Warn when the data of the IDE (logs, pictures, plans, history) grows big; on by default.
    pub storage_warnings: bool,
    /// The warning limits are multiplied by this (1 to 100); 0 = not chosen (1).
    pub storage_warn_multiplier: u32,
}

impl Default for ChatSettings {
    fn default() -> Self {
        Self {
            avatar: String::new(),
            user_name: String::new(),
            assistant_name: String::new(),
            voice: String::new(),
            custom_instructions: String::new(),
            default_cli: String::new(),
            claude_model: String::new(),
            codex_model: String::new(),
            claude_plan: String::new(),
            codex_plan: String::new(),
            fallback_enabled: false,
            fallback_order: Vec::new(),
            language: String::new(),
            appearance: String::new(),
            code_colors: String::new(),
            voice_engine: String::new(),
            vieneu_url: String::new(),
            vieneu_voice: String::new(),
            voice_rate: 0,
            save_plans_to_project: false,
            plans_dir: String::new(),
            storage_warnings: true,
            storage_warn_multiplier: 0,
        }
    }
}

impl ChatSettings {
    /// The folder plans are saved to: `plans_dir`, or `docs/plans` when it is empty.
    pub fn effective_plans_dir(&self) -> String {
        crate::plans::project::checked_plans_dir(&self.plans_dir)
            .unwrap_or_else(|| crate::plans::project::DEFAULT_PLANS_DIR.to_string())
    }

    /// The factor of the storage warning limits (at least 1).
    pub fn effective_warn_multiplier(&self) -> u32 {
        self.storage_warn_multiplier.max(1)
    }

    fn plans_dir_valid(dir: &str) -> bool {
        crate::plans::project::checked_plans_dir(dir).is_some()
    }

    fn multiplier_valid(multiplier: u32) -> bool {
        multiplier <= MAX_WARN_MULTIPLIER
    }

    fn validate(&self) -> Result<(), SettingsError> {
        validation::avatar(&self.avatar)
            .map_err(|error| SettingsError::Rejected(rule_key(&error)))?;

        for text in [
            &self.user_name,
            &self.assistant_name,
            &self.voice,
            &self.vieneu_url,
            &self.vieneu_voice,
        ] {
            validation::plain_text(text)
                .map_err(|error| SettingsError::Rejected(rule_key(&error)))?;
        }

        validation::multiline_text(&self.custom_instructions)
            .map_err(|error| SettingsError::Rejected(rule_key(&error)))?;

        for model in [&self.claude_model, &self.codex_model] {
            if !model.is_empty() {
                validation::valid_model(model)
                    .map_err(|error| SettingsError::Rejected(rule_key(&error)))?;
            }
        }

        if !Self::plans_dir_valid(&self.plans_dir) {
            return Err(SettingsError::Rejected("settings.bad_plans_dir"));
        }

        if self.options_valid() {
            Ok(())
        } else {
            Err(SettingsError::Invalid)
        }
    }

    /// The choice fields and the lengths of the text fields.
    fn options_valid(&self) -> bool {
        let cli_ok = Self::cli_valid(&self.default_cli);
        let language_ok = Self::language_valid(&self.language);
        let theme_ok =
            Self::appearance_valid(&self.appearance) && Self::code_colors_valid(&self.code_colors);
        let plans_ok = CLAUDE_PLANS.contains(&self.claude_plan.as_str())
            && CODEX_PLANS.contains(&self.codex_plan.as_str());
        let order_ok = Self::order_valid(&self.fallback_order);
        let lengths_ok = self.user_name.chars().count() <= MAX_NAME_CHARS
            && self.assistant_name.chars().count() <= MAX_NAME_CHARS
            && self.voice.chars().count() <= MAX_VOICE_CHARS
            && self.custom_instructions.chars().count() <= MAX_INSTRUCTIONS_CHARS;

        let speech_ok = Self::speech_valid(&self.voice_engine, &self.vieneu_url)
            && Self::rate_valid(self.voice_rate)
            && self.vieneu_voice.chars().count() <= MAX_VOICE_CHARS;

        let storage_ok = Self::plans_dir_valid(&self.plans_dir)
            && Self::multiplier_valid(self.storage_warn_multiplier);

        cli_ok
            && language_ok
            && theme_ok
            && plans_ok
            && order_ok
            && lengths_ok
            && speech_ok
            && storage_ok
    }

    fn rate_valid(rate: u32) -> bool {
        rate == 0 || (MIN_VOICE_RATE..=MAX_VOICE_RATE).contains(&rate)
    }

    fn speech_valid(engine: &str, url: &str) -> bool {
        matches!(engine, "" | "system" | "vieneu")
            && url.chars().count() <= MAX_URL_CHARS
            && (url.is_empty() || speech::is_loopback_url(url))
    }

    fn cli_valid(cli: &str) -> bool {
        cli.is_empty() || CliKind::parse_agent(cli).is_some()
    }

    fn language_valid(language: &str) -> bool {
        matches!(language, "" | "vi" | "en")
    }

    fn appearance_valid(appearance: &str) -> bool {
        matches!(appearance, "" | "system" | "light" | "dark")
    }

    fn code_colors_valid(code_colors: &str) -> bool {
        matches!(
            code_colors,
            "" | "auto" | "light" | "dark" | "light-colorblind" | "dark-colorblind"
        )
    }

    fn order_valid(order: &[String]) -> bool {
        order.len() <= 2
            && order.iter().enumerate().all(|(index, cli)| {
                CliKind::parse_agent(cli).is_some() && !order[..index].contains(cli)
            })
    }

    /// Settings read from the database: every field that no longer passes its rule falls back to the default, the rest is kept.
    fn sanitized(mut self) -> Self {
        let defaults = Self::default();
        let text_ok = |text: &str, max: usize| {
            text.chars().count() <= max && validation::plain_text(text).is_ok()
        };

        if validation::avatar(&self.avatar).is_err() {
            self.avatar = defaults.avatar.clone();
        }
        for (text, max) in [
            (&mut self.user_name, MAX_NAME_CHARS),
            (&mut self.assistant_name, MAX_NAME_CHARS),
            (&mut self.voice, MAX_VOICE_CHARS),
            (&mut self.vieneu_voice, MAX_VOICE_CHARS),
        ] {
            if !text_ok(text, max) {
                text.clear();
            }
        }
        if self.custom_instructions.chars().count() > MAX_INSTRUCTIONS_CHARS
            || validation::multiline_text(&self.custom_instructions).is_err()
        {
            self.custom_instructions.clear();
        }
        for model in [&mut self.claude_model, &mut self.codex_model] {
            if !model.is_empty() && validation::valid_model(model).is_err() {
                model.clear();
            }
        }
        if !Self::cli_valid(&self.default_cli) {
            self.default_cli.clear();
        }
        if !CLAUDE_PLANS.contains(&self.claude_plan.as_str()) {
            self.claude_plan.clear();
        }
        if !CODEX_PLANS.contains(&self.codex_plan.as_str()) {
            self.codex_plan.clear();
        }
        if !Self::order_valid(&self.fallback_order) {
            self.fallback_order = defaults.fallback_order;
        }
        if !Self::language_valid(&self.language) {
            self.language.clear();
        }
        if !Self::appearance_valid(&self.appearance) {
            self.appearance.clear();
        }
        if !Self::code_colors_valid(&self.code_colors) {
            self.code_colors.clear();
        }
        if !Self::rate_valid(self.voice_rate) {
            self.voice_rate = 0;
        }
        if !Self::plans_dir_valid(&self.plans_dir) {
            self.plans_dir.clear();
        }
        if !Self::multiplier_valid(self.storage_warn_multiplier) {
            self.storage_warn_multiplier = 0;
        }
        if !Self::speech_valid("", &self.vieneu_url) {
            self.vieneu_url.clear();
        }
        if !Self::speech_valid(&self.voice_engine, "") {
            self.voice_engine.clear();
        }

        self
    }
}

fn rule_key(error: &validation::ValidationError) -> &'static str {
    match error.key() {
        validation::KEY_TOO_LONG => validation::KEY_TOO_LONG,
        validation::KEY_BAD_AVATAR => validation::KEY_BAD_AVATAR,
        validation::KEY_BAD_MODEL => validation::KEY_BAD_MODEL,
        _ => validation::KEY_CONTROL_CHAR,
    }
}

pub struct SettingsStore {
    connection: Mutex<Connection>,
}

impl SettingsStore {
    fn new(connection: Connection) -> Result<Self, rusqlite::Error> {
        connection.execute_batch(migrations::CREATE_SETTINGS_TABLE)?;

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
        let value: Option<String> =
            sql::find_by_key(&connection, "settings", &["value"], "key", KEY, |row| {
                row.get(0)
            })
            .map_err(|_| SettingsError::LoadFailed)?;

        value.map_or_else(
            || Ok(ChatSettings::default()),
            |json| {
                serde_json::from_str::<ChatSettings>(&json)
                    .map(ChatSettings::sanitized)
                    .map_err(|_| SettingsError::LoadFailed)
            },
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

        sql::upsert(
            &connection,
            "settings",
            &["key"],
            vec![("key", Value::from(KEY)), ("value", Value::from(json))],
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
#[path = "../tests/unit/settings.rs"]
mod tests;
