//! Several accounts per AI CLI. Each extra account is a profile: a folder of its own inside Rynox's data folder, given to the CLI through `CLAUDE_CONFIG_DIR` / `CODEX_HOME`, so its login never touches `~/.claude` or `~/.codex`.
//! Profile `0` is the CLI's own default login and is always there; one profile per CLI is the active one that chats and statistics use.

use crate::cli::CliKind;
use crate::{db, migrations, sql, validation};
use rusqlite::{params, Connection, OptionalExtension};
use sea_query::{Alias, Condition, Expr, ExprTrait, Func, Query, Value};
use serde::Serialize;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

/// The CLI's own login, not managed by Rynox.
pub const DEFAULT_PROFILE: i64 = 0;
const DEFAULT_NAME: &str = "Mặc định";
const MAX_NAME_CHARS: usize = 40;
const MAX_PER_CLI: i64 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileError {
    Invalid,
    TooMany,
    NotFound,
    Failed,
}

impl ProfileError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::Invalid => "profiles.invalid",
            Self::TooMany => "profiles.too_many",
            Self::NotFound => "profiles.not_found",
            Self::Failed => "profiles.failed",
        }
    }
}

impl fmt::Display for ProfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ProfileError {}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Profile {
    pub id: i64,
    pub cli: String,
    pub name: String,
    pub active: bool,
}

pub struct ProfileStore {
    connection: Mutex<Connection>,
    root: PathBuf,
}

impl ProfileStore {
    fn new(connection: Connection, root: PathBuf) -> Result<Self, rusqlite::Error> {
        connection.execute_batch(migrations::CREATE_PROFILES_TABLES)?;

        Ok(Self {
            connection: Mutex::new(connection),
            root,
        })
    }

    fn variable(cli: &str) -> Result<&'static str, ProfileError> {
        CliKind::parse(cli)
            .filter(|kind| CliKind::ALL.contains(kind))
            .map(CliKind::config_variable)
            .ok_or(ProfileError::Invalid)
    }

    fn folder(&self, cli: &str, id: i64) -> PathBuf {
        self.root.join(format!("{cli}-{id}"))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, ProfileError> {
        self.connection.lock().map_err(|_| ProfileError::Failed)
    }

    /// Id of the profile that `cli` currently uses; the default one when none was chosen or the chosen one is gone.
    pub fn active_id(&self, cli: &str) -> i64 {
        let Ok(connection) = self.lock() else {
            return DEFAULT_PROFILE;
        };

        connection
            .query_row(
                "SELECT a.profile_id FROM active_profiles a
                 JOIN profiles p ON p.id = a.profile_id AND p.cli = a.cli
                 WHERE a.cli = ?1",
                [cli],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .unwrap_or(DEFAULT_PROFILE)
    }

    /// Every profile of every CLI, the default one first in each.
    ///
    /// # Errors
    /// Fails when the table cannot be read.
    pub fn list(&self) -> Result<Vec<Profile>, ProfileError> {
        let mut profiles = Vec::new();

        for kind in CliKind::ALL {
            let cli = kind.name();
            let active = self.active_id(cli);
            let rows = sql::list_ordered(
                &*self.lock()?,
                "profiles",
                &["id", "name"],
                Condition::all().add(same("cli", cli)),
                "id",
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|_| ProfileError::Failed)?;

            profiles.push(Profile {
                id: DEFAULT_PROFILE,
                cli: cli.to_string(),
                name: DEFAULT_NAME.to_string(),
                active: active == DEFAULT_PROFILE,
            });
            profiles.extend(rows.into_iter().map(|(id, name)| Profile {
                id,
                cli: cli.to_string(),
                name,
                active: id == active,
            }));
        }

        Ok(profiles)
    }

    /// Adds an account for `cli` and creates its folder.
    ///
    /// # Errors
    /// Fails on an unknown CLI, an empty or overlong name, too many accounts, or when the folder or row cannot be created.
    pub fn add(&self, cli: &str, name: &str) -> Result<(), ProfileError> {
        Self::variable(cli)?;

        let name = name.trim();

        if name.chars().count() > MAX_NAME_CHARS || validation::display_name(name).is_err() {
            return Err(ProfileError::Invalid);
        }

        let connection = self.lock()?;
        let count = sql::query_first(
            &connection,
            Query::select()
                .expr(Func::count(Expr::cust("*")))
                .from(Alias::new("profiles"))
                .and_where(same("cli", cli)),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| ProfileError::Failed)?
        .unwrap_or_default();

        if count >= MAX_PER_CLI {
            return Err(ProfileError::TooMany);
        }

        connection
            .execute(
                "INSERT INTO profiles (cli, name) VALUES (?1, ?2)",
                params![cli, name],
            )
            .map_err(|_| ProfileError::Failed)?;

        let id = connection.last_insert_rowid();

        if create_private_folder(&self.folder(cli, id)).is_err() {
            let _ = sql::delete_where(
                &connection,
                "profiles",
                Condition::all().add(same("id", id)),
            );

            return Err(ProfileError::Failed);
        }

        Ok(())
    }

    /// Removes an account and its folder (its login with it). The default profile cannot be removed.
    ///
    /// # Errors
    /// Fails on the default or an unknown profile, or when the row cannot be removed.
    pub fn remove(&self, cli: &str, id: i64) -> Result<(), ProfileError> {
        Self::variable(cli)?;

        if id == DEFAULT_PROFILE {
            return Err(ProfileError::Invalid);
        }

        let connection = self.lock()?;
        let removed = sql::delete_where(
            &connection,
            "profiles",
            Condition::all().add(same("id", id)).add(same("cli", cli)),
        )
        .map_err(|_| ProfileError::Failed)?;

        if removed == 0 {
            return Err(ProfileError::NotFound);
        }

        sql::delete_where(
            &connection,
            "active_profiles",
            Condition::all()
                .add(same("cli", cli))
                .add(same("profile_id", id)),
        )
        .map_err(|_| ProfileError::Failed)?;
        // Best effort: the folder is Rynox's own and sits exactly at `<root>/<cli>-<id>`.
        let _ = fs::remove_dir_all(self.folder(cli, id));

        Ok(())
    }

    /// Renames an account; the default profile keeps its fixed name.
    ///
    /// # Errors
    /// Fails on an unknown CLI, the default profile, an empty or overlong name, or an unknown account.
    pub fn rename(&self, cli: &str, id: i64, name: &str) -> Result<(), ProfileError> {
        Self::variable(cli)?;

        let name = name.trim();

        if id == DEFAULT_PROFILE
            || name.chars().count() > MAX_NAME_CHARS
            || validation::display_name(name).is_err()
        {
            return Err(ProfileError::Invalid);
        }

        let changed = sql::execute(
            &*self.lock()?,
            Query::update()
                .table(Alias::new("profiles"))
                .value(Alias::new("name"), name)
                .and_where(same("id", id))
                .and_where(same("cli", cli)),
        )
        .map_err(|_| ProfileError::Failed)?;

        if changed == 0 {
            return Err(ProfileError::NotFound);
        }

        Ok(())
    }

    /// Makes `id` the account `cli` chats with.
    ///
    /// # Errors
    /// Fails on an unknown CLI or profile, or when the choice cannot be saved.
    pub fn select(&self, cli: &str, id: i64) -> Result<(), ProfileError> {
        Self::variable(cli)?;
        self.environment(cli, id)?;

        sql::upsert(
            &*self.lock()?,
            "active_profiles",
            &["cli"],
            vec![("cli", cli.into()), ("profile_id", id.into())],
        )
        .map_err(|_| ProfileError::Failed)?;

        Ok(())
    }

    /// Environment that points `cli` at profile `id`; empty for the default profile.
    ///
    /// # Errors
    /// Fails on an unknown CLI or profile, so a wrong id never falls back to another account silently.
    pub fn environment(
        &self,
        cli: &str,
        id: i64,
    ) -> Result<Vec<(&'static str, String)>, ProfileError> {
        let variable = Self::variable(cli)?;

        if id == DEFAULT_PROFILE {
            return Ok(Vec::new());
        }

        let exists = sql::query_first(
            &*self.lock()?,
            Query::select()
                .column(Alias::new("id"))
                .from(Alias::new("profiles"))
                .and_where(same("id", id))
                .and_where(same("cli", cli)),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| ProfileError::Failed)?;

        exists.ok_or(ProfileError::NotFound)?;

        Ok(vec![(variable, self.folder(cli, id).display().to_string())])
    }

    /// Environment of the active profile of `cli`; an unreadable choice gives the default profile.
    pub fn active_environment(&self, cli: &str) -> Vec<(&'static str, String)> {
        self.environment(cli, self.active_id(cli))
            .unwrap_or_default()
    }
}

/// `column = value` on a fixed column name.
fn same(column: &str, value: impl Into<Value>) -> Expr {
    Expr::col(Alias::new(column)).eq(value)
}

fn create_private_folder(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }

    Ok(())
}

/// Called once at start-up; profile folders live next to the database file.
///
/// # Errors
/// Fails when the tables cannot be created.
pub fn setup(app: &tauri::App, database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let connection = db::open(database).unwrap_or_else(|_| db::in_memory());
    let root = database.parent().map_or_else(
        || PathBuf::from("profiles"),
        |parent| parent.join("profiles"),
    );

    app.manage(ProfileStore::new(connection, root)?);

    Ok(())
}

#[tauri::command]
pub fn profiles_list(store: State<ProfileStore>) -> Result<Vec<Profile>, String> {
    store.list().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_add(
    store: State<ProfileStore>,
    cli: String,
    name: String,
) -> Result<Vec<Profile>, String> {
    store.add(&cli, &name).map_err(|error| error.to_string())?;

    store.list().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_remove(
    store: State<ProfileStore>,
    cli: String,
    id: i64,
) -> Result<Vec<Profile>, String> {
    store.remove(&cli, id).map_err(|error| error.to_string())?;

    store.list().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_rename(
    store: State<ProfileStore>,
    cli: String,
    id: i64,
    name: String,
) -> Result<Vec<Profile>, String> {
    store
        .rename(&cli, id, &name)
        .map_err(|error| error.to_string())?;

    store.list().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_select(
    store: State<ProfileStore>,
    cli: String,
    id: i64,
) -> Result<Vec<Profile>, String> {
    store.select(&cli, id).map_err(|error| error.to_string())?;

    store.list().map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "../tests/unit/profiles.rs"]
mod tests;
