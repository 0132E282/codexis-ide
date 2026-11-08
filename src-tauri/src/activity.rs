//! What the IDE remembers about the work in a project, in the app's SQLite file (never in the user's project folder): file edit events, pictures of the chat and the index of the plan files.
//!
//! Privacy: a file event holds the path, the kind of change and sizes, never the code, the diff, a prompt or an answer (the same rule as [`crate::run_log`]). Deleting rows here never touches a file on disk.

use crate::migrations;
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Largest picture kept.
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
/// Total size of the pictures of one project; older ones are dropped to make room for a new one.
pub const MAX_PROJECT_IMAGE_BYTES: i64 = 256 * 1024 * 1024;
/// Pictures up to this size come back inline (as a thumbnail) in the list.
pub const THUMBNAIL_MAX_BYTES: i64 = 32 * 1024;
/// Most rows one list call returns.
pub const MAX_PAGE: u32 = 500;
/// Most ids one delete call takes.
pub const MAX_IDS: usize = 1000;
const MAX_NAME_CHARS: usize = 80;
const MAX_PATH_CHARS: usize = 1024;

/// Tools of the AI CLI that change a file, and the input field that names it.
const EDIT_TOOLS: [(&str, &str); 4] = [
    ("Edit", "file_path"),
    ("Write", "file_path"),
    ("MultiEdit", "file_path"),
    ("NotebookEdit", "notebook_path"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityError {
    LoadFailed,
    SaveFailed,
    DeleteFailed,
    TooManyIds,
    ImageNotImage,
    ImageTooLarge,
    ImageNotFound,
}

impl ActivityError {
    /// Fixed user-facing text (an `errors.*` key of the interface).
    pub fn message(self) -> &'static str {
        match self {
            Self::LoadFailed => "activity.load_failed",
            Self::SaveFailed => "activity.save_failed",
            Self::DeleteFailed => "activity.delete_failed",
            Self::TooManyIds => "activity.too_many_ids",
            Self::ImageNotImage => "chat_images.not_image",
            Self::ImageTooLarge => "chat_images.too_large",
            Self::ImageNotFound => "chat_images.not_found",
        }
    }
}

impl fmt::Display for ActivityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ActivityError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAction {
    Create,
    Save,
    Delete,
    Rename,
    Copy,
    Move,
    Discard,
    AiEdit,
}

impl FileAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Save => "save",
            Self::Delete => "delete",
            Self::Rename => "rename",
            Self::Copy => "copy",
            Self::Move => "move",
            Self::Discard => "discard",
            Self::AiEdit => "ai_edit",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileSource {
    User,
    Ai,
}

impl FileSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Ai => "ai",
        }
    }
}

/// A file event about to be stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewFileEvent {
    pub project_root: String,
    pub path: String,
    pub action: FileAction,
    pub source: FileSource,
    pub bytes_after: Option<i64>,
    pub lines_added: Option<i64>,
    pub lines_removed: Option<i64>,
    pub old_path: Option<String>,
}

impl NewFileEvent {
    /// An event of the person with no sizes (rename, copy, move, discard...).
    pub fn user(project_root: &str, path: &str, action: FileAction) -> Self {
        Self {
            project_root: project_root.to_string(),
            path: path.to_string(),
            action,
            source: FileSource::User,
            bytes_after: None,
            lines_added: None,
            lines_removed: None,
            old_path: None,
        }
    }

    pub fn with_old_path(mut self, old_path: &str) -> Self {
        self.old_path = Some(old_path.to_string());
        self
    }

    /// A change the AI made to `path`; its content is never looked at, so no sizes.
    pub fn ai_edit(project_root: &str, path: &str) -> Self {
        Self {
            source: FileSource::Ai,
            ..Self::user(project_root, path, FileAction::AiEdit)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEvent {
    pub id: i64,
    pub project_root: String,
    pub path: String,
    pub action: String,
    pub source: String,
    pub bytes_after: Option<i64>,
    pub lines_added: Option<i64>,
    pub lines_removed: Option<i64>,
    pub old_path: Option<String>,
    pub created_at: i64,
}

/// What a list of file events is narrowed by; `path` matches anywhere in the path, `from` and `to` are Unix seconds (both ends included).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FileEventFilter {
    pub path: Option<String>,
    pub action: Option<String>,
    pub source: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    /// Rows that match, whatever the page.
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatImage {
    pub id: i64,
    pub conversation_id: Option<i64>,
    pub name: String,
    pub mime: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub created_at: i64,
    /// Base64 of the picture itself when it is small (at most [`THUMBNAIL_MAX_BYTES`]); none for a bigger one: ask `chat_image_get`.
    pub thumbnail_base64: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub mime: String,
    pub data_base64: String,
}

/// A plan file about to be indexed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewPlanRecord {
    pub path: String,
    pub title: String,
    pub status: String,
    pub tasks_total: i64,
    pub tasks_done: i64,
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRecord {
    pub id: i64,
    pub project_root: String,
    pub path: String,
    pub title: String,
    pub status: String,
    pub tasks_total: i64,
    pub tasks_done: i64,
    pub format: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct ActivityStore {
    connection: Mutex<Connection>,
}

impl ActivityStore {
    /// # Errors
    /// Fails when the tables cannot be created.
    pub fn new(connection: Connection) -> Result<Self, ActivityError> {
        connection
            .execute_batch(migrations::CREATE_ACTIVITY_TABLES)
            .map_err(|_| ActivityError::SaveFailed)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(
        &self,
        error: ActivityError,
    ) -> Result<std::sync::MutexGuard<'_, Connection>, ActivityError> {
        self.connection.lock().map_err(|_| error)
    }

    /// Runs `work` with the connection (the storage report reads other tables of the same file).
    ///
    /// # Errors
    /// `activity.load_failed` when the connection is unusable or `work` fails.
    pub fn read<T>(
        &self,
        work: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, ActivityError> {
        let connection = self.lock(ActivityError::LoadFailed)?;

        work(&connection).map_err(|_| ActivityError::LoadFailed)
    }

    // ---- file events -------------------------------------------------------------------

    /// Stores an event at the current time.
    ///
    /// # Errors
    /// `activity.save_failed` when the row cannot be written.
    pub fn record_file_event(&self, event: &NewFileEvent) -> Result<(), ActivityError> {
        self.record_file_event_at(event, now_seconds())
    }

    pub fn record_file_event_at(
        &self,
        event: &NewFileEvent,
        seconds: i64,
    ) -> Result<(), ActivityError> {
        self.lock(ActivityError::SaveFailed)?
            .execute(
                "INSERT INTO file_events (project_root, path, action, source, bytes_after, lines_added, lines_removed, old_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    event.project_root,
                    event.path,
                    event.action.as_str(),
                    event.source.as_str(),
                    event.bytes_after,
                    event.lines_added,
                    event.lines_removed,
                    event.old_path,
                    seconds,
                ],
            )
            .map(|_| ())
            .map_err(|_| ActivityError::SaveFailed)
    }

    /// The events of a project, newest first.
    ///
    /// # Errors
    /// `activity.load_failed` when the rows cannot be read.
    pub fn list_file_events(
        &self,
        root: &str,
        filter: &FileEventFilter,
        limit: u32,
        offset: u32,
    ) -> Result<Page<FileEvent>, ActivityError> {
        let connection = self.lock(ActivityError::LoadFailed)?;
        let (clause, values) = file_event_clause(root, filter);
        let total: i64 = connection
            .query_row(
                &format!("SELECT COUNT(*) FROM file_events WHERE {clause}"),
                params_from_iter(values.clone()),
                |row| row.get(0),
            )
            .map_err(|_| ActivityError::LoadFailed)?;
        let mut page_values = values;

        page_values.push(SqlValue::Integer(i64::from(limit.clamp(1, MAX_PAGE))));
        page_values.push(SqlValue::Integer(i64::from(offset)));

        let mut statement = connection
            .prepare(&format!(
                "SELECT id, project_root, path, action, source, bytes_after, lines_added, lines_removed, old_path, created_at FROM file_events WHERE {clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
            ))
            .map_err(|_| ActivityError::LoadFailed)?;
        let items = statement
            .query_map(params_from_iter(page_values), |row| {
                Ok(FileEvent {
                    id: row.get(0)?,
                    project_root: row.get(1)?,
                    path: row.get(2)?,
                    action: row.get(3)?,
                    source: row.get(4)?,
                    bytes_after: row.get(5)?,
                    lines_added: row.get(6)?,
                    lines_removed: row.get(7)?,
                    old_path: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })
            .and_then(Iterator::collect)
            .map_err(|_| ActivityError::LoadFailed)?;

        Ok(Page { items, total })
    }

    /// Deletes the events with these ids; returns how many rows went.
    ///
    /// # Errors
    /// `activity.too_many_ids` over [`MAX_IDS`], `activity.delete_failed` when the rows cannot be deleted.
    pub fn delete_file_events(&self, ids: &[i64]) -> Result<usize, ActivityError> {
        self.delete_by_ids("file_events", ids)
    }

    /// Deletes the events of a project, only those before `before` (Unix seconds) when given.
    ///
    /// # Errors
    /// `activity.delete_failed` when the rows cannot be deleted.
    pub fn clear_file_events(
        &self,
        root: &str,
        before: Option<i64>,
    ) -> Result<usize, ActivityError> {
        self.delete_older("file_events", "created_at", root, before)
    }

    // ---- chat images -------------------------------------------------------------------

    /// Keeps a picture of the chat; the same content in a project is one row. Older pictures of the project go when the total passes the quota (so a paste never fails for lack of room).
    ///
    /// # Errors
    /// `chat_images.not_image` when the bytes are no known picture, `chat_images.too_large` over [`MAX_IMAGE_BYTES`], `activity.save_failed` on a database error.
    pub fn save_image(
        &self,
        root: &str,
        conversation: Option<i64>,
        name: &str,
        data: &[u8],
    ) -> Result<i64, ActivityError> {
        self.save_image_with(
            root,
            conversation,
            name,
            data,
            MAX_PROJECT_IMAGE_BYTES,
            now_seconds(),
        )
    }

    pub fn save_image_with(
        &self,
        root: &str,
        conversation: Option<i64>,
        name: &str,
        data: &[u8],
        quota: i64,
        seconds: i64,
    ) -> Result<i64, ActivityError> {
        let mime = image_mime(data).ok_or(ActivityError::ImageNotImage)?;

        if data.len() > MAX_IMAGE_BYTES {
            return Err(ActivityError::ImageTooLarge);
        }

        let hash = format!("{:x}", Sha256::digest(data));
        let size = i64::try_from(data.len()).map_err(|_| ActivityError::ImageTooLarge)?;
        let mut connection = self.lock(ActivityError::SaveFailed)?;
        let transaction = connection
            .transaction()
            .map_err(|_| ActivityError::SaveFailed)?;
        let existing: Option<i64> = transaction
            .query_row(
                "SELECT id FROM chat_images WHERE project_root = ?1 AND sha256 = ?2",
                params![root, hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ActivityError::SaveFailed)?;

        if let Some(id) = existing {
            return Ok(id);
        }

        transaction
            .execute(
                "INSERT INTO chat_images (project_root, conversation_id, name, mime, size_bytes, sha256, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![root, conversation, safe_name(name), mime, size, hash, data, seconds],
            )
            .map_err(|_| ActivityError::SaveFailed)?;

        let id = transaction.last_insert_rowid();

        // * Oldest first, never the picture just kept.
        transaction
            .execute(
                "DELETE FROM chat_images WHERE project_root = ?1 AND id != ?2 AND id IN (SELECT id FROM (SELECT id, SUM(size_bytes) OVER (ORDER BY created_at DESC, id DESC) AS running FROM chat_images WHERE project_root = ?1) WHERE running > ?3)",
                params![root, id, quota],
            )
            .map_err(|_| ActivityError::SaveFailed)?;
        transaction
            .commit()
            .map_err(|_| ActivityError::SaveFailed)?;

        Ok(id)
    }

    /// The pictures of a project, newest first, without their bytes (small ones carry a thumbnail).
    ///
    /// # Errors
    /// `activity.load_failed` when the rows cannot be read.
    pub fn list_images(
        &self,
        root: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Page<ChatImage>, ActivityError> {
        let connection = self.lock(ActivityError::LoadFailed)?;
        let total: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chat_images WHERE project_root = ?1",
                [root],
                |row| row.get(0),
            )
            .map_err(|_| ActivityError::LoadFailed)?;
        let mut statement = connection
            .prepare("SELECT id, conversation_id, name, mime, size_bytes, sha256, created_at, CASE WHEN size_bytes <= ?2 THEN data END FROM chat_images WHERE project_root = ?1 ORDER BY created_at DESC, id DESC LIMIT ?3 OFFSET ?4")
            .map_err(|_| ActivityError::LoadFailed)?;
        let items = statement
            .query_map(
                params![
                    root,
                    THUMBNAIL_MAX_BYTES,
                    i64::from(limit.clamp(1, MAX_PAGE)),
                    i64::from(offset)
                ],
                |row| {
                    let thumbnail: Option<Vec<u8>> = row.get(7)?;

                    Ok(ChatImage {
                        id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        name: row.get(2)?,
                        mime: row.get(3)?,
                        size_bytes: row.get(4)?,
                        sha256: row.get(5)?,
                        created_at: row.get(6)?,
                        thumbnail_base64: thumbnail.map(|bytes| base64_encode(&bytes)),
                    })
                },
            )
            .and_then(Iterator::collect)
            .map_err(|_| ActivityError::LoadFailed)?;

        Ok(Page { items, total })
    }

    /// The picture `id` as base64.
    ///
    /// # Errors
    /// `chat_images.not_found` when there is no such picture, `activity.load_failed` on a database error.
    pub fn image(&self, id: i64) -> Result<ImageData, ActivityError> {
        let connection = self.lock(ActivityError::LoadFailed)?;
        let found: Option<(String, Vec<u8>)> = connection
            .query_row(
                "SELECT mime, data FROM chat_images WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ActivityError::LoadFailed)?;

        found
            .map(|(mime, data)| ImageData {
                mime,
                data_base64: base64_encode(&data),
            })
            .ok_or(ActivityError::ImageNotFound)
    }

    /// Deletes the pictures kept for `conversation` and returns their content hashes (hex), so the caller can remove the copies it holds elsewhere.
    ///
    /// # Errors
    /// `activity.delete_failed` when the database cannot be read or written.
    pub fn delete_conversation_images(
        &self,
        conversation: i64,
    ) -> Result<Vec<String>, ActivityError> {
        let connection = self.lock(ActivityError::DeleteFailed)?;
        let mut statement = connection
            .prepare("SELECT sha256 FROM chat_images WHERE conversation_id = ?1")
            .map_err(|_| ActivityError::DeleteFailed)?;
        let hashes = statement
            .query_map([conversation], |row| row.get::<_, String>(0))
            .and_then(Iterator::collect::<rusqlite::Result<Vec<String>>>)
            .map_err(|_| ActivityError::DeleteFailed)?;

        drop(statement);
        connection
            .execute(
                "DELETE FROM chat_images WHERE conversation_id = ?1",
                [conversation],
            )
            .map_err(|_| ActivityError::DeleteFailed)?;

        Ok(hashes)
    }

    /// # Errors
    /// See [`Self::delete_file_events`].
    pub fn delete_images(&self, ids: &[i64]) -> Result<usize, ActivityError> {
        self.delete_by_ids("chat_images", ids)
    }

    // ---- plan records ------------------------------------------------------------------

    /// Adds the index row of a plan file, or refreshes it when the project already has one for that path.
    ///
    /// # Errors
    /// `activity.save_failed` when the row cannot be written.
    pub fn upsert_plan_record(
        &self,
        root: &str,
        record: &NewPlanRecord,
    ) -> Result<i64, ActivityError> {
        let connection = self.lock(ActivityError::SaveFailed)?;

        upsert_plan(&connection, root, record, now_seconds()).map_err(|_| ActivityError::SaveFailed)
    }

    /// Makes the index match `plans` (the files found now): adds and refreshes rows, and with `prune` drops the rows of files that are gone. Returns `(upserted, removed)`.
    ///
    /// # Errors
    /// `activity.save_failed` when a row cannot be written.
    pub fn sync_plan_records(
        &self,
        root: &str,
        plans: &[NewPlanRecord],
        prune: bool,
    ) -> Result<(usize, usize), ActivityError> {
        let mut connection = self.lock(ActivityError::SaveFailed)?;
        let transaction = connection
            .transaction()
            .map_err(|_| ActivityError::SaveFailed)?;
        let seconds = now_seconds();

        for plan in plans {
            upsert_plan(&transaction, root, plan, seconds)
                .map_err(|_| ActivityError::SaveFailed)?;
        }

        let mut removed = 0;

        if prune {
            let known: Vec<String> = {
                let mut statement = transaction
                    .prepare("SELECT path FROM plan_records WHERE project_root = ?1")
                    .map_err(|_| ActivityError::SaveFailed)?;

                statement
                    .query_map([root], |row| row.get(0))
                    .and_then(Iterator::collect)
                    .map_err(|_| ActivityError::SaveFailed)?
            };

            // * A set of the kept paths makes the prune O(rows + plans) instead of O(rows * plans).
            let kept: HashSet<&str> = plans.iter().map(|plan| plan.path.as_str()).collect();

            for path in known {
                if !kept.contains(path.as_str()) {
                    removed += transaction
                        .execute(
                            "DELETE FROM plan_records WHERE project_root = ?1 AND path = ?2",
                            params![root, path],
                        )
                        .map_err(|_| ActivityError::SaveFailed)?;
                }
            }
        }

        transaction
            .commit()
            .map_err(|_| ActivityError::SaveFailed)?;

        Ok((plans.len(), removed))
    }

    /// The index rows of a project, most recently updated first.
    ///
    /// # Errors
    /// `activity.load_failed` when the rows cannot be read.
    pub fn list_plan_records(&self, root: &str) -> Result<Vec<PlanRecord>, ActivityError> {
        let connection = self.lock(ActivityError::LoadFailed)?;
        let mut statement = connection
            .prepare("SELECT id, project_root, path, title, status, tasks_total, tasks_done, format, created_at, updated_at FROM plan_records WHERE project_root = ?1 ORDER BY updated_at DESC, id DESC")
            .map_err(|_| ActivityError::LoadFailed)?;

        statement
            .query_map([root], |row| {
                Ok(PlanRecord {
                    id: row.get(0)?,
                    project_root: row.get(1)?,
                    path: row.get(2)?,
                    title: row.get(3)?,
                    status: row.get(4)?,
                    tasks_total: row.get(5)?,
                    tasks_done: row.get(6)?,
                    format: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .and_then(Iterator::collect)
            .map_err(|_| ActivityError::LoadFailed)
    }

    /// Deletes index rows only; the plan files stay where they are.
    ///
    /// # Errors
    /// See [`Self::delete_file_events`].
    pub fn delete_plan_records(&self, ids: &[i64]) -> Result<usize, ActivityError> {
        self.delete_by_ids("plan_records", ids)
    }

    // ---- shared ------------------------------------------------------------------------

    /// `table` is one of this module's fixed names.
    fn delete_by_ids(&self, table: &str, ids: &[i64]) -> Result<usize, ActivityError> {
        if ids.len() > MAX_IDS {
            return Err(ActivityError::TooManyIds);
        }

        if ids.is_empty() {
            return Ok(0);
        }

        let marks = vec!["?"; ids.len()].join(", ");

        self.lock(ActivityError::DeleteFailed)?
            .execute(
                &format!("DELETE FROM {table} WHERE id IN ({marks})"),
                params_from_iter(ids),
            )
            .map_err(|_| ActivityError::DeleteFailed)
    }

    /// Deletes the rows of a project whose `column` (a Unix time) is before `before`, or all of them when it is none. `table` and `column` are fixed names of this module.
    pub(crate) fn delete_older(
        &self,
        table: &str,
        column: &str,
        root: &str,
        before: Option<i64>,
    ) -> Result<usize, ActivityError> {
        let connection = self.lock(ActivityError::DeleteFailed)?;
        let result = match before {
            Some(before) => connection.execute(
                &format!("DELETE FROM {table} WHERE project_root = ?1 AND {column} < ?2"),
                params![root, before],
            ),
            None => connection.execute(
                &format!("DELETE FROM {table} WHERE project_root = ?1"),
                [root],
            ),
        };

        result.map_err(|_| ActivityError::DeleteFailed)
    }
}

fn upsert_plan(
    connection: &Connection,
    root: &str,
    record: &NewPlanRecord,
    seconds: i64,
) -> rusqlite::Result<i64> {
    connection.execute(
        "INSERT INTO plan_records (project_root, path, title, status, tasks_total, tasks_done, format, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) ON CONFLICT (project_root, path) DO UPDATE SET title = excluded.title, status = excluded.status, tasks_total = excluded.tasks_total, tasks_done = excluded.tasks_done, format = excluded.format, updated_at = excluded.updated_at",
        params![
            root,
            record.path,
            record.title,
            record.status,
            record.tasks_total,
            record.tasks_done,
            record.format,
            seconds,
        ],
    )?;

    connection.query_row(
        "SELECT id FROM plan_records WHERE project_root = ?1 AND path = ?2",
        params![root, record.path],
        |row| row.get(0),
    )
}

/// The `WHERE` text of a file-event query and its values; only fixed fragments are written into the text.
fn file_event_clause(root: &str, filter: &FileEventFilter) -> (String, Vec<SqlValue>) {
    let mut clause = String::from("project_root = ?");
    let mut values = vec![SqlValue::Text(root.to_string())];

    if let Some(path) = filter.path.as_deref().filter(|path| !path.is_empty()) {
        let escaped = path
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");

        clause.push_str(" AND (path LIKE ? ESCAPE '\\' OR old_path LIKE ? ESCAPE '\\')");
        values.push(SqlValue::Text(format!("%{escaped}%")));
        values.push(SqlValue::Text(format!("%{escaped}%")));
    }

    if let Some(action) = &filter.action {
        clause.push_str(" AND action = ?");
        values.push(SqlValue::Text(action.clone()));
    }

    if let Some(source) = &filter.source {
        clause.push_str(" AND source = ?");
        values.push(SqlValue::Text(source.clone()));
    }

    if let Some(from) = filter.from {
        clause.push_str(" AND created_at >= ?");
        values.push(SqlValue::Integer(from));
    }

    if let Some(to) = filter.to {
        clause.push_str(" AND created_at <= ?");
        values.push(SqlValue::Integer(to));
    }

    (clause, values)
}

/// Stores `event`; when that fails the row is not kept and `report` is told the error key. The file operation that was logged is never undone or failed because of this.
pub fn record_or_report(
    store: &ActivityStore,
    event: &NewFileEvent,
    report: impl FnOnce(&NewFileEvent, &'static str),
) {
    if let Err(error) = store.record_file_event(event) {
        report(event, error.message());
    }
}

/// Lines added and removed going from `old` to `new`: lines are matched as a multiset, so moving a line around is no change and an edited line counts as one removed and one added.
pub fn line_change(old: &str, new: &str) -> (i64, i64) {
    let mut counts: HashMap<&str, i64> = HashMap::new();

    for line in old.lines() {
        *counts.entry(line).or_default() += 1;
    }

    let mut added = 0;

    for line in new.lines() {
        match counts.get_mut(line) {
            Some(count) if *count > 0 => *count -= 1,
            _ => added += 1,
        }
    }

    (added, counts.values().sum())
}

/// Whether `name` is a tool of the AI CLI that writes a file.
pub fn is_edit_tool(name: &str) -> bool {
    EDIT_TOOLS.iter().any(|(tool, _)| *tool == name)
}

/// The path (relative to the project) that an edit tool call changes, read from its `input`; none when it is not an edit tool, names no path, or the path is outside every one of `roots` (the project folder and the folder the AI works in). Nothing else of the input is looked at.
pub fn ai_edit_path(name: &str, input: &Value, roots: &[&Path]) -> Option<String> {
    let (_, field) = EDIT_TOOLS.iter().find(|(tool, _)| *tool == name)?;
    let raw = input.get(*field)?.as_str()?;

    if raw.is_empty() || raw.chars().count() > MAX_PATH_CHARS {
        return None;
    }

    let relative = if Path::new(raw).is_absolute() {
        roots
            .iter()
            .find_map(|root| Path::new(raw).strip_prefix(root).ok())?
            .to_string_lossy()
            .replace('\\', "/")
    } else {
        raw.to_string()
    };

    crate::workspace::normalise(&relative)
}

/// The kind of picture the bytes are (by their first bytes), or none.
pub fn image_mime(data: &[u8]) -> Option<&'static str> {
    match data {
        [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        [b'B', b'M', ..] => Some("image/bmp"),
        _ => None,
    }
}

/// Only the last path segment, without control characters, at most [`MAX_NAME_CHARS`] characters; `image` when nothing is left.
fn safe_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_NAME_CHARS)
        .collect();

    if cleaned.trim().is_empty() {
        "image".to_string()
    } else {
        cleaned
    }
}

pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut text = String::with_capacity(data.len().div_ceil(3) * 4);

    for chunk in data.chunks(3) {
        let bytes = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let group = (u32::from(bytes[0]) << 16) | (u32::from(bytes[1]) << 8) | u32::from(bytes[2]);

        for (index, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if index <= chunk.len() {
                text.push(char::from(TABLE[(group >> shift & 63) as usize]));
            } else {
                text.push('=');
            }
        }
    }

    text
}

/// The bytes of a `data:<type>;base64,<data>` URL; `None` when it is not one or the data is not valid base64.
pub fn base64_data_url_bytes(url: &str) -> Option<Vec<u8>> {
    let (head, body) = url.strip_prefix("data:")?.split_once(',')?;

    if !head.ends_with(";base64") {
        return None;
    }

    let mut bytes = Vec::with_capacity(body.len() / 4 * 3);
    let mut group = 0u32;
    let mut count = 0u32;

    for symbol in body.bytes().take_while(|symbol| *symbol != b'=') {
        let value = match symbol {
            b'A'..=b'Z' => symbol - b'A',
            b'a'..=b'z' => symbol - b'a' + 26,
            b'0'..=b'9' => symbol - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };

        group = (group << 6) | u32::from(value);
        count += 1;

        if count == 4 {
            bytes.extend_from_slice(&group.to_be_bytes()[1..]);
            group = 0;
            count = 0;
        }
    }

    match count {
        0 => {}
        2 => bytes.push((group >> 4) as u8),
        3 => bytes.extend_from_slice(&[(group >> 10) as u8, (group >> 2) as u8]),
        _ => return None,
    }

    Some(bytes)
}

pub fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(0))
}

/// Called once at start-up with the database path: opens the file and `app.manage(...)`s the store.
///
/// # Errors
/// Fails when the tables cannot be created.
pub fn setup(app: &tauri::App, database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;

    let connection = crate::db::open(database).unwrap_or_else(|_| crate::db::in_memory());

    app.manage(ActivityStore::new(connection)?);

    Ok(())
}

#[cfg(test)]
#[path = "../tests/unit/activity.rs"]
mod tests;
