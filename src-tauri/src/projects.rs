//! Saved projects (name, folders, environment variables) kept in the SQLite file of the app data folder (see `db`).
//!
//! Environment values are stored as plain text in that file (owner-only permissions on Unix) and are never printed: `EnvVar` redacts its value in `Debug` and errors carry fixed messages only.

use crate::{db, seeders, sql, validation};
use rusqlite::{params, Connection};
use sea_query::{Alias, Condition, Expr, ExprTrait, Value};
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
            Self::InvalidName => "projects.invalid_name",
            Self::TooMany => "projects.too_many",
            Self::InvalidFolder => "projects.invalid_folder",
            Self::InvalidEnv => "projects.invalid_env",
            Self::NotFound => "projects.not_found",
            Self::NoFolder => "projects.no_folder",
            Self::SaveFailed => "projects.save_failed",
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
        if seeders::is_done(&self.connection, LEGACY_IMPORTED) {
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

        seeders::mark_done(&self.connection, LEGACY_IMPORTED);
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
    let projects = sql::list_ordered(
        connection,
        "projects",
        &["id", "name", "folders", "env"],
        Condition::all(),
        "position",
        |row| {
            let folders: String = row.get(2)?;
            let env: String = row.get(3)?;

            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                folders: serde_json::from_str(&folders).unwrap_or_default(),
                env: serde_json::from_str(&env).unwrap_or_default(),
            })
        },
    )?;
    let selected = sql::find_by_key(connection, "meta", &["value"], "key", SELECTED, |row| {
        row.get(0)
    })?;

    Ok(Saved { projects, selected })
}

/// Replaces the saved projects in one transaction: a failure leaves the file as it was.
fn write_saved(connection: &mut Connection, saved: &Saved) -> Result<()> {
    let write = |connection: &mut Connection| -> rusqlite::Result<()> {
        let transaction = connection.transaction()?;

        sql::delete_where(&transaction, "projects", Condition::all())?;

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
            Some(id) => sql::upsert(
                &transaction,
                "meta",
                &["key"],
                vec![
                    ("key", Value::from(SELECTED)),
                    ("value", Value::from(id.as_str())),
                ],
            )?,
            None => sql::delete_where(
                &transaction,
                "meta",
                Condition::all().add(Expr::col(Alias::new("key")).eq(SELECTED)),
            )?,
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
            || validation::env_name(&var.key).is_err()
            || var.value.len() > MAX_ENV_VALUE_BYTES
            || validation::env_value(&var.value).is_err()
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
#[path = "../tests/unit/projects.rs"]
mod tests;
