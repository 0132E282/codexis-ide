//! Several accounts per AI CLI. Each extra account is a profile: a folder of its own inside Rynox's data folder, given to the CLI through `CLAUDE_CONFIG_DIR` / `CODEX_HOME`, so its login never touches `~/.claude` or `~/.codex`.
//! Profile `0` is the CLI's own default login and is always there; one profile per CLI is the active one that chats and statistics use.

use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
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
/// CLI name and the environment variable that points it at a profile folder.
const CLIS: [(&str, &str); 3] = [
    ("claude", "CLAUDE_CONFIG_DIR"),
    ("codex", "CODEX_HOME"),
    ("github", "GH_CONFIG_DIR"),
];

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
            Self::Invalid => "Tên hoặc loại tài khoản không hợp lệ.",
            Self::TooMany => "Đã đủ số tài khoản tối đa cho CLI này.",
            Self::NotFound => "Không tìm thấy tài khoản.",
            Self::Failed => "Không xử lý được tài khoản.",
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
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cli TEXT NOT NULL,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS active_profiles (
                cli TEXT PRIMARY KEY,
                profile_id INTEGER NOT NULL
            );",
        )?;

        Ok(Self {
            connection: Mutex::new(connection),
            root,
        })
    }

    fn variable(cli: &str) -> Result<&'static str, ProfileError> {
        CLIS.iter()
            .find(|(name, _)| *name == cli)
            .map(|(_, variable)| *variable)
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

        for (cli, _) in CLIS {
            let active = self.active_id(cli);
            let connection = self.lock()?;
            let mut statement = connection
                .prepare("SELECT id, name FROM profiles WHERE cli = ?1 ORDER BY id")
                .map_err(|_| ProfileError::Failed)?;
            let rows = statement
                .query_map([cli], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|_| ProfileError::Failed)?
                .collect::<rusqlite::Result<Vec<_>>>()
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

        if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
            return Err(ProfileError::Invalid);
        }

        let connection = self.lock()?;
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM profiles WHERE cli = ?1",
                [cli],
                |row| row.get(0),
            )
            .map_err(|_| ProfileError::Failed)?;

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
            let _ = connection.execute("DELETE FROM profiles WHERE id = ?1", [id]);

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
        let removed = connection
            .execute(
                "DELETE FROM profiles WHERE id = ?1 AND cli = ?2",
                params![id, cli],
            )
            .map_err(|_| ProfileError::Failed)?;

        if removed == 0 {
            return Err(ProfileError::NotFound);
        }

        connection
            .execute(
                "DELETE FROM active_profiles WHERE cli = ?1 AND profile_id = ?2",
                params![cli, id],
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

        if id == DEFAULT_PROFILE || name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
            return Err(ProfileError::Invalid);
        }

        let changed = self
            .lock()?
            .execute(
                "UPDATE profiles SET name = ?1 WHERE id = ?2 AND cli = ?3",
                params![name, id, cli],
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

        self.lock()?
            .execute(
                "INSERT INTO active_profiles (cli, profile_id) VALUES (?1, ?2)
                 ON CONFLICT(cli) DO UPDATE SET profile_id = excluded.profile_id",
                params![cli, id],
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

        let exists: Option<i64> = self
            .lock()?
            .query_row(
                "SELECT id FROM profiles WHERE id = ?1 AND cli = ?2",
                params![id, cli],
                |row| row.get(0),
            )
            .optional()
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
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, ProfileStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(db::in_memory(), dir.path().join("profiles")).unwrap();

        (dir, store)
    }

    fn names(store: &ProfileStore, cli: &str) -> Vec<String> {
        store
            .list()
            .unwrap()
            .into_iter()
            .filter(|profile| profile.cli == cli)
            .map(|profile| profile.name)
            .collect()
    }

    #[test]
    fn default_profile_is_always_first_and_active() {
        let (_dir, store) = store();
        let list = store.list().unwrap();

        assert_eq!(list.len(), 3);
        assert!(list
            .iter()
            .all(|profile| profile.id == DEFAULT_PROFILE && profile.active));
        assert!(store.active_environment("claude").is_empty());
    }

    #[test]
    fn added_account_has_a_private_folder_and_an_environment() {
        let (dir, store) = store();

        store.add("claude", " Công việc ").unwrap();

        assert_eq!(names(&store, "claude"), ["Mặc định", "Công việc"]);
        assert_eq!(names(&store, "codex"), ["Mặc định"]);

        let id = store
            .list()
            .unwrap()
            .iter()
            .find(|p| p.name == "Công việc")
            .unwrap()
            .id;
        let environment = store.environment("claude", id).unwrap();

        assert_eq!(environment[0].0, "CLAUDE_CONFIG_DIR");
        assert_eq!(
            PathBuf::from(&environment[0].1),
            dir.path().join("profiles").join(format!("claude-{id}"))
        );
        assert!(PathBuf::from(&environment[0].1).is_dir());
    }

    #[test]
    fn selecting_switches_the_environment_and_removing_goes_back() {
        let (_dir, store) = store();

        store.add("codex", "Cá nhân").unwrap();

        let id = store
            .list()
            .unwrap()
            .iter()
            .find(|p| p.name == "Cá nhân")
            .unwrap()
            .id;

        store.select("codex", id).unwrap();
        assert_eq!(store.active_id("codex"), id);
        assert_eq!(store.active_environment("codex")[0].0, "CODEX_HOME");

        let folder = PathBuf::from(&store.active_environment("codex")[0].1);

        store.remove("codex", id).unwrap();
        assert_eq!(store.active_id("codex"), DEFAULT_PROFILE);
        assert!(store.active_environment("codex").is_empty());
        assert!(!folder.exists());
    }

    #[test]
    fn an_account_can_be_renamed_but_not_the_default() {
        let (_dir, store) = store();

        store.add("claude", "Tài khoản 2").unwrap();

        let id = store
            .list()
            .unwrap()
            .iter()
            .find(|p| p.name == "Tài khoản 2")
            .unwrap()
            .id;

        store.rename("claude", id, " Công việc ").unwrap();
        assert_eq!(names(&store, "claude"), ["Mặc định", "Công việc"]);
        assert_eq!(
            store.rename("claude", DEFAULT_PROFILE, "x"),
            Err(ProfileError::Invalid)
        );
        assert_eq!(store.rename("claude", id, "  "), Err(ProfileError::Invalid));
        assert_eq!(store.rename("codex", id, "x"), Err(ProfileError::NotFound));
    }

    #[test]
    fn bad_requests_are_refused() {
        let (_dir, store) = store();

        assert_eq!(store.add("gemini", "x"), Err(ProfileError::Invalid));
        assert_eq!(store.add("claude", "  "), Err(ProfileError::Invalid));
        assert_eq!(
            store.add("claude", &"x".repeat(41)),
            Err(ProfileError::Invalid)
        );
        assert_eq!(
            store.remove("claude", DEFAULT_PROFILE),
            Err(ProfileError::Invalid)
        );
        assert_eq!(store.remove("claude", 99), Err(ProfileError::NotFound));
        assert_eq!(store.select("claude", 99), Err(ProfileError::NotFound));
        assert!(store.environment("claude", 99).is_err());
    }

    #[test]
    fn an_id_of_another_cli_is_not_found() {
        let (_dir, store) = store();

        store.add("claude", "A").unwrap();

        let id = store
            .list()
            .unwrap()
            .iter()
            .find(|p| p.name == "A")
            .unwrap()
            .id;

        assert_eq!(store.select("codex", id), Err(ProfileError::NotFound));
    }

    #[test]
    fn number_of_accounts_is_limited() {
        let (_dir, store) = store();

        for index in 0..MAX_PER_CLI {
            store.add("claude", &format!("A{index}")).unwrap();
        }

        assert_eq!(store.add("claude", "one more"), Err(ProfileError::TooMany));
        store.add("codex", "other cli").unwrap();
    }
}
