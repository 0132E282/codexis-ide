//! Saved projects (name, folders, environment variables) kept in the SQLite file of the app data folder (see `db`).
//!
//! Environment values are stored as plain text in that file (owner-only permissions on Unix) and are never printed: `EnvVar` redacts its value in `Debug` and errors carry fixed messages only.

use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;
use std::fs;
use std::path::PathBuf;

/// Set once the projects of an old `projects.json` were copied in, so a project deleted later does not come back.
const LEGACY_IMPORTED: &str = "legacy_projects_imported";
const SELECTED: &str = "selected_project";

pub const MAX_PROJECTS: usize = 100;
pub const MAX_NAME_CHARS: usize = 100;
pub const MAX_FOLDERS: usize = 20;
pub const MAX_ENV_VARS: usize = 100;
pub const MAX_ENV_VALUE_BYTES: usize = 4096;
const MAX_ENV_KEY_BYTES: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectError {
    InvalidName,
    TooMany,
    InvalidFolder,
    InvalidEnv,
    NotFound,
    NoFolder,
    SaveFailed,
}

impl ProjectError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidName => "Tên dự án không hợp lệ.",
            Self::TooMany => "Dự án có quá nhiều mục hoặc đã đạt giới hạn số dự án.",
            Self::InvalidFolder => "Thư mục không tồn tại hoặc không hợp lệ.",
            Self::InvalidEnv => "Biến môi trường không hợp lệ.",
            Self::NotFound => "Không tìm thấy dự án.",
            Self::NoFolder => "Dự án chưa có thư mục để mở.",
            Self::SaveFailed => "Không lưu được danh sách dự án.",
        }
    }
}

impl fmt::Display for ProjectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ProjectError {}

pub type Result<T> = std::result::Result<T, ProjectError>;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

impl fmt::Debug for EnvVar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EnvVar")
            .field("key", &self.key)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// Real paths of existing folders; the first one is the workspace root.
    pub folders: Vec<String>,
    pub env: Vec<EnvVar>,
}

/// What the person typed in the dialog, before validation.
#[derive(Debug, Deserialize)]
pub struct NewProject {
    pub name: String,
    pub folders: Vec<String>,
    pub env: Vec<EnvVar>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Saved {
    projects: Vec<Project>,
    /// Project opened last time, reopened at start-up.
    selected: Option<String>,
}

#[derive(Debug)]
pub struct ProjectStore {
    path: PathBuf,
    connection: Connection,
    saved: Saved,
}

impl ProjectStore {
    /// Opens the database and reads the saved projects. When the file cannot be opened at all the store lives in memory only, so the IDE still starts.
    ///
    /// Projects of an old `projects.json` next to the database are copied in once; that file itself is left untouched.
    pub fn load(path: PathBuf) -> Self {
        let connection = db::open(&path).unwrap_or_else(|_| {
            eprintln!("database cannot be opened; projects are kept in memory only");

            db::in_memory()
        });
        let saved = read_saved(&connection).unwrap_or_default();
        let mut store = Self {
            path,
            connection,
            saved,
        };

        store.import_legacy();

        store
    }

    fn import_legacy(&mut self) {
        let imported = self
            .connection
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                [LEGACY_IMPORTED],
                |_| Ok(()),
            )
            .optional()
            .is_ok_and(|row| row.is_some());

        if imported {
            return;
        }

        let legacy = self.path.with_file_name("projects.json");

        if let Some(saved) = fs::read(&legacy)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok())
        {
            if self.saved.projects.is_empty() && self.commit(saved).is_err() {
                return;
            }
        }

        // Best effort: without the flag the import is only tried again at the next start.
        let _ = self.connection.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, '1')",
            [LEGACY_IMPORTED],
        );
    }

    pub fn projects(&self) -> &[Project] {
        &self.saved.projects
    }

    /// Id of the project opened last time.
    pub fn selected(&self) -> Option<&str> {
        self.saved.selected.as_deref()
    }

    pub fn get(&self, id: &str) -> Option<&Project> {
        self.saved.projects.iter().find(|project| project.id == id)
    }

    /// Validates and saves a new project.
    ///
    /// # Errors
    /// Fails on a bad name, a folder that is not an existing directory, bad or duplicate variable names, too many items, or when the file cannot be written.
    pub fn add(&mut self, new: NewProject) -> Result<Project> {
        let name = new.name.trim();

        if name.is_empty()
            || name.chars().count() > MAX_NAME_CHARS
            || name.contains(char::is_control)
        {
            return Err(ProjectError::InvalidName);
        }

        if self.saved.projects.len() >= MAX_PROJECTS
            || new.folders.len() > MAX_FOLDERS
            || new.env.len() > MAX_ENV_VARS
        {
            return Err(ProjectError::TooMany);
        }

        let folders = real_folders(&new.folders)?;

        // * The same folders again is the same project: it is handed back, not saved a second time.
        if let Some(known) = self
            .saved
            .projects
            .iter()
            .find(|project| !folders.is_empty() && same_folders(&project.folders, &folders))
        {
            return Ok(known.clone());
        }

        let project = Project {
            id: self.next_id(),
            name: name.to_string(),
            folders,
            env: checked_env(new.env)?,
        };
        let mut next = self.saved.clone();

        next.projects.push(project.clone());
        self.commit(next)?;

        Ok(project)
    }

    /// Forgets a project (its folders stay on disk).
    ///
    /// # Errors
    /// Fails when the id is unknown or the file cannot be written.
    pub fn remove(&mut self, id: &str) -> Result<()> {
        self.get(id).ok_or(ProjectError::NotFound)?;

        let mut next = self.saved.clone();

        next.projects.retain(|project| project.id != id);

        if next.selected.as_deref() == Some(id) {
            next.selected = None;
        }

        self.commit(next)
    }

    /// Remembers the project to reopen at the next start.
    ///
    /// # Errors
    /// Fails when the id is unknown or the file cannot be written.
    pub fn select(&mut self, id: &str) -> Result<()> {
        self.get(id).ok_or(ProjectError::NotFound)?;

        let mut next = self.saved.clone();

        next.selected = Some(id.to_string());

        self.commit(next)
    }

    /// Ids look like `p7`: one more than the largest number in use.
    fn next_id(&self) -> String {
        let highest = self
            .saved
            .projects
            .iter()
            .filter_map(|project| project.id.strip_prefix('p')?.parse::<u64>().ok())
            .max()
            .unwrap_or(0);

        format!("p{}", highest + 1)
    }

    /// Writes first, replaces the in-memory copy only when the write worked.
    fn commit(&mut self, next: Saved) -> Result<()> {
        write_saved(&mut self.connection, &next)?;
        self.saved = next;

        Ok(())
    }
}

fn read_saved(connection: &Connection) -> rusqlite::Result<Saved> {
    let mut statement =
        connection.prepare("SELECT id, name, folders, env FROM projects ORDER BY position")?;
    let projects = statement
        .query_map([], |row| {
            let folders: String = row.get(2)?;
            let env: String = row.get(3)?;

            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                folders: serde_json::from_str(&folders).unwrap_or_default(),
                env: serde_json::from_str(&env).unwrap_or_default(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let selected = connection
        .query_row("SELECT value FROM meta WHERE key = ?1", [SELECTED], |row| {
            row.get(0)
        })
        .optional()?;

    Ok(Saved { projects, selected })
}

/// Replaces the saved projects in one transaction: a failure leaves the file as it was.
fn write_saved(connection: &mut Connection, saved: &Saved) -> Result<()> {
    let write = |connection: &mut Connection| -> rusqlite::Result<()> {
        let transaction = connection.transaction()?;

        transaction.execute("DELETE FROM projects", [])?;

        for (position, project) in saved.projects.iter().enumerate() {
            transaction.execute(
                "INSERT INTO projects (id, position, name, folders, env) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    project.id,
                    position as i64,
                    project.name,
                    serde_json::to_string(&project.folders).unwrap_or_default(),
                    serde_json::to_string(&project.env).unwrap_or_default(),
                ],
            )?;
        }

        match &saved.selected {
            Some(id) => transaction.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
                params![SELECTED, id],
            )?,
            None => transaction.execute("DELETE FROM meta WHERE key = ?1", [SELECTED])?,
        };

        transaction.commit()
    };

    write(connection).map_err(|_| ProjectError::SaveFailed)
}

/// Whether both lists hold the same folders, in any order.
fn same_folders(left: &[String], right: &[String]) -> bool {
    left.len() == right.len() && left.iter().all(|folder| right.contains(folder))
}

/// Each folder as a real path, which must be an existing directory; repeats are dropped.
fn real_folders(folders: &[String]) -> Result<Vec<String>> {
    let mut real: Vec<String> = Vec::with_capacity(folders.len());

    for folder in folders {
        let path = fs::canonicalize(folder).map_err(|_| ProjectError::InvalidFolder)?;

        if !path.is_dir() {
            return Err(ProjectError::InvalidFolder);
        }

        let path = path.to_str().ok_or(ProjectError::InvalidFolder)?;

        if !real.iter().any(|known| known == path) {
            real.push(path.to_string());
        }
    }

    Ok(real)
}

fn checked_env(env: Vec<EnvVar>) -> Result<Vec<EnvVar>> {
    let mut seen = HashSet::new();

    for var in &env {
        if !valid_env_key(&var.key)
            || var.value.len() > MAX_ENV_VALUE_BYTES
            || var.value.contains('\0')
            || !seen.insert(var.key.as_str())
        {
            return Err(ProjectError::InvalidEnv);
        }
    }

    Ok(env)
}

/// Shell-safe names: letters, digits and `_`, not starting with a digit.
fn valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();

    key.len() <= MAX_ENV_KEY_BYTES
        && chars
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::TempDir;

    fn store() -> (TempDir, ProjectStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ProjectStore::load(dir.path().join("data").join("rynox.db"));

        (dir, store)
    }

    fn new_project(name: &str, folders: &[&Path]) -> NewProject {
        NewProject {
            name: name.to_string(),
            folders: folders
                .iter()
                .map(|folder| folder.display().to_string())
                .collect(),
            env: vec![EnvVar {
                key: "API_TOKEN".into(),
                value: "s3cret".into(),
            }],
        }
    }

    #[test]
    fn added_project_survives_a_reload() {
        let (dir, mut store) = store();
        let folder = dir.path().join("app");

        fs::create_dir(&folder).unwrap();

        let added = store.add(new_project("  Ứng dụng  ", &[&folder])).unwrap();
        store.select(&added.id).unwrap();

        let reloaded = ProjectStore::load(store.path.clone());

        assert_eq!(reloaded.projects(), std::slice::from_ref(&added));
        assert_eq!(reloaded.selected(), Some(added.id.as_str()));
        assert_eq!(added.name, "Ứng dụng");
        assert_eq!(
            added.folders,
            [fs::canonicalize(&folder).unwrap().display().to_string()]
        );
    }

    #[test]
    fn adding_the_same_folders_returns_the_existing_project() {
        let (dir, mut store) = store();
        let folder = dir.path().join("app");

        fs::create_dir(&folder).unwrap();

        let first = store.add(new_project("app", &[&folder])).unwrap();
        let again = store.add(new_project("other name", &[&folder])).unwrap();

        assert_eq!(again, first);
        assert_eq!(store.projects().len(), 1);
    }

    #[test]
    fn ids_are_not_reused_while_a_later_project_exists() {
        let (_dir, mut store) = store();
        let first = store.add(new_project("a", &[])).unwrap();
        let second = store.add(new_project("b", &[])).unwrap();

        store.remove(&first.id).unwrap();

        let third = store.add(new_project("c", &[])).unwrap();

        assert_ne!(third.id, second.id);
    }

    #[test]
    fn bad_input_is_refused_and_nothing_is_saved() {
        let (dir, mut store) = store();
        let file = dir.path().join("file.txt");

        fs::write(&file, "x").unwrap();

        let refused = [
            (new_project("   ", &[]), ProjectError::InvalidName),
            (
                new_project("x", &[&dir.path().join("missing")]),
                ProjectError::InvalidFolder,
            ),
            (new_project("x", &[&file]), ProjectError::InvalidFolder),
        ];

        for (project, error) in refused {
            assert_eq!(store.add(project).unwrap_err(), error);
        }

        for key in ["", "1A", "A B", "A=B", "A\n"] {
            let mut project = new_project("x", &[]);

            project.env[0].key = key.into();

            assert_eq!(
                store.add(project).unwrap_err(),
                ProjectError::InvalidEnv,
                "key {key:?}"
            );
        }

        let mut duplicate = new_project("x", &[]);

        duplicate.env.push(duplicate.env[0].clone());

        assert_eq!(store.add(duplicate).unwrap_err(), ProjectError::InvalidEnv);
        assert!(store.projects().is_empty());
        assert!(ProjectStore::load(store.path.clone()).projects().is_empty());
    }

    #[test]
    fn removing_the_selected_project_clears_the_selection() {
        let (_dir, mut store) = store();
        let project = store.add(new_project("a", &[])).unwrap();

        store.select(&project.id).unwrap();
        store.remove(&project.id).unwrap();

        assert_eq!(store.selected(), None);
        assert_eq!(store.remove(&project.id), Err(ProjectError::NotFound));
        assert_eq!(store.select("p99"), Err(ProjectError::NotFound));
    }

    #[test]
    fn file_that_is_not_a_database_is_moved_aside_and_the_store_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rynox.db");

        fs::write(
            &path,
            "this is not a database, just text that is long enough",
        )
        .unwrap();

        let store = ProjectStore::load(path.clone());

        assert!(store.projects().is_empty());
        assert!(dir.path().join("rynox.db.corrupt").exists());
    }

    #[test]
    fn projects_of_an_old_json_file_are_copied_in_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rynox.db");
        let legacy = dir.path().join("projects.json");
        let json =
            r#"{"projects":[{"id":"p3","name":"Cũ","folders":[],"env":[]}],"selected":"p3"}"#;

        fs::write(&legacy, json).unwrap();

        let mut store = ProjectStore::load(path.clone());

        assert_eq!(store.projects().len(), 1);
        assert_eq!(store.selected(), Some("p3"));
        assert_eq!(fs::read_to_string(&legacy).unwrap(), json);

        // Deleted in the app: the old file must not bring it back at the next start.
        store.remove("p3").unwrap();

        assert!(ProjectStore::load(path).projects().is_empty());
    }

    #[test]
    fn debug_output_never_shows_a_value() {
        let var = EnvVar {
            key: "API_TOKEN".into(),
            value: "s3cret".into(),
        };

        assert!(!format!("{var:?}").contains("s3cret"));
    }

    #[cfg(unix)]
    #[test]
    fn store_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let (_dir, mut store) = store();

        store.add(new_project("a", &[])).unwrap();

        let mode = fs::metadata(&store.path).unwrap().permissions().mode();

        assert_eq!(mode & 0o777, 0o600);
    }
}
