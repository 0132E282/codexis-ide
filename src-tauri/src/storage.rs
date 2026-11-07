//! How much room the IDE's own data takes, with warnings when a kind grows too big, and the cleanup the person confirms.
//!
//! Only the app's own data is looked at or removed here: rows of the app's SQLite file, and the files of the project's folder in the app data (`logs/`, `plans/`). Nothing is ever removed on its own (the report only warns) and nothing in a user's project folder is touched.

use crate::activity::{ActivityError, ActivityStore};
use rusqlite::params;
use serde::Serialize;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const MIB: i64 = 1024 * 1024;
const GIB: i64 = 1024 * MIB;
const SECONDS_PER_DAY: u64 = 86_400;
/// A notice starts at this share (percent) of the warning limit.
const NOTICE_PERCENT: i64 = 50;
/// Rough size of the fixed part of a stored row, added to its text lengths.
const ROW_OVERHEAD_BYTES: i64 = 48;

pub const IMAGES_WARNING_BYTES: i64 = 128 * MIB;
pub const IMAGES_CRITICAL_BYTES: i64 = 512 * MIB;
pub const FILE_EVENTS_WARNING_COUNT: i64 = 20_000;
pub const FILE_EVENTS_CRITICAL_COUNT: i64 = 100_000;
pub const PLAN_RECORDS_WARNING_COUNT: i64 = 300;
pub const PLAN_RECORDS_CRITICAL_COUNT: i64 = 1_000;
pub const RUN_LOGS_WARNING_BYTES: i64 = 50 * MIB;
pub const RUN_LOGS_CRITICAL_BYTES: i64 = 200 * MIB;
pub const DATABASE_WARNING_BYTES: i64 = 512 * MIB;
pub const DATABASE_CRITICAL_BYTES: i64 = 2 * GIB;
pub const CHAT_HISTORY_WARNING_COUNT: i64 = 5_000;
pub const CHAT_HISTORY_CRITICAL_COUNT: i64 = 50_000;
pub const CHAT_HISTORY_WARNING_BYTES: i64 = 64 * MIB;
pub const CHAT_HISTORY_CRITICAL_BYTES: i64 = 256 * MIB;
pub const SESSION_PLANS_WARNING_BYTES: i64 = 32 * MIB;
pub const SESSION_PLANS_CRITICAL_BYTES: i64 = 128 * MIB;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageError {
    ConfirmRequired,
    BadKind,
    ReadFailed,
    CleanupFailed,
    Activity(ActivityError),
}

impl StorageError {
    pub fn message(self) -> &'static str {
        match self {
            Self::ConfirmRequired => "storage.confirm_required",
            Self::BadKind => "storage.bad_kind",
            Self::ReadFailed => "storage.read_failed",
            Self::CleanupFailed => "storage.cleanup_failed",
            Self::Activity(error) => error.message(),
        }
    }
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for StorageError {}

impl From<ActivityError> for StorageError {
    fn from(error: ActivityError) -> Self {
        Self::Activity(error)
    }
}

/// One limit: crossing it by count of rows or by bytes (either one set) trips it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Limit {
    pub bytes: Option<i64>,
    pub count: Option<i64>,
}

impl Limit {
    fn exceeded_by(self, count: i64, bytes: i64) -> bool {
        self.bytes.is_some_and(|limit| bytes > limit)
            || self.count.is_some_and(|limit| count > limit)
    }

    fn scaled(self, percent: i64) -> Self {
        Self {
            bytes: self.bytes.map(|limit| limit * percent / 100),
            count: self.count.map(|limit| limit * percent / 100),
        }
    }
}

/// The warning and critical limit of one kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub warning: Limit,
    pub critical: Limit,
}

const fn bytes(warning: i64, critical: i64) -> Limits {
    Limits {
        warning: Limit {
            bytes: Some(warning),
            count: None,
        },
        critical: Limit {
            bytes: Some(critical),
            count: None,
        },
    }
}

const fn count(warning: i64, critical: i64) -> Limits {
    Limits {
        warning: Limit {
            bytes: None,
            count: Some(warning),
        },
        critical: Limit {
            bytes: None,
            count: Some(critical),
        },
    }
}

/// Limits of every kind, by its report name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Thresholds(pub Vec<(&'static str, Limits)>);

impl Thresholds {
    /// The default limits, every one multiplied by `multiplier` (the setting `storageWarnMultiplier`, at least 1).
    pub fn standard(multiplier: u32) -> Self {
        let factor = i64::from(multiplier.max(1));
        let scale = |limits: Limits| Limits {
            warning: limits.warning.scaled(factor * 100),
            critical: limits.critical.scaled(factor * 100),
        };

        Self(vec![
            (
                "chat_images",
                scale(bytes(IMAGES_WARNING_BYTES, IMAGES_CRITICAL_BYTES)),
            ),
            (
                "file_events",
                scale(count(FILE_EVENTS_WARNING_COUNT, FILE_EVENTS_CRITICAL_COUNT)),
            ),
            (
                "plan_records",
                scale(count(
                    PLAN_RECORDS_WARNING_COUNT,
                    PLAN_RECORDS_CRITICAL_COUNT,
                )),
            ),
            (
                "run_logs",
                scale(bytes(RUN_LOGS_WARNING_BYTES, RUN_LOGS_CRITICAL_BYTES)),
            ),
            (
                "db",
                scale(bytes(DATABASE_WARNING_BYTES, DATABASE_CRITICAL_BYTES)),
            ),
            (
                "chat_history",
                scale(Limits {
                    warning: Limit {
                        bytes: Some(CHAT_HISTORY_WARNING_BYTES),
                        count: Some(CHAT_HISTORY_WARNING_COUNT),
                    },
                    critical: Limit {
                        bytes: Some(CHAT_HISTORY_CRITICAL_BYTES),
                        count: Some(CHAT_HISTORY_CRITICAL_COUNT),
                    },
                }),
            ),
            (
                "session_plans",
                scale(bytes(
                    SESSION_PLANS_WARNING_BYTES,
                    SESSION_PLANS_CRITICAL_BYTES,
                )),
            ),
        ])
    }

    fn of(&self, kind: &str) -> Option<Limits> {
        self.0
            .iter()
            .find(|(name, _)| *name == kind)
            .map(|(_, limits)| *limits)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageItem {
    pub kind: &'static str,
    pub count: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageWarning {
    pub kind: &'static str,
    /// `notice`, `warning` or `critical`.
    pub level: &'static str,
    pub count: i64,
    pub bytes: i64,
    /// The limit that was crossed (the one of the level), when it is a size.
    pub threshold_bytes: Option<i64>,
    /// The limit that was crossed, when it is a number of rows.
    pub threshold_count: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub total_bytes: i64,
    pub items: Vec<UsageItem>,
    pub warnings: Vec<StorageWarning>,
}

/// `items` and `warnings` are about the project; `app` is the same for all projects together (its warnings include the database file).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub total_bytes: i64,
    pub db_bytes: i64,
    pub items: Vec<UsageItem>,
    pub warnings: Vec<StorageWarning>,
    pub app: Scope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleaned {
    /// Rows or files removed.
    pub deleted: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupKind {
    FileEvents,
    ChatImages,
    PlanRecords,
    RunLogs,
    SessionPlans,
}

impl CleanupKind {
    /// Chat history is the person's own and is deleted with `chat_delete`, so it is not a cleanup kind.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "file_events" => Some(Self::FileEvents),
            "chat_images" => Some(Self::ChatImages),
            "plan_records" => Some(Self::PlanRecords),
            "run_logs" => Some(Self::RunLogs),
            "session_plans" => Some(Self::SessionPlans),
            _ => None,
        }
    }
}

/// Where to look: the project (`root` and its folder in the app data) or, with none, the whole app.
#[derive(Debug, Clone, Copy)]
pub struct Sources<'a> {
    pub root: Option<&'a str>,
    /// The folder `<data>/projects/` that holds one folder per project.
    pub projects_dir: &'a Path,
    /// The project's own folder in there (when `root` is given).
    pub project_dir: Option<&'a Path>,
    pub database: &'a Path,
}

/// The report: counts and sizes of the project and of the whole app, with the warnings the limits give. `warn` false leaves the warnings empty (the person turned them off).
///
/// # Errors
/// `storage.read_failed` when the database cannot be read.
pub fn usage(
    store: &ActivityStore,
    sources: &Sources<'_>,
    thresholds: &Thresholds,
    warn: bool,
) -> Result<StorageUsage, StorageError> {
    let project_dirs: Vec<PathBuf> = sources
        .project_dir
        .map(Path::to_path_buf)
        .into_iter()
        .collect();
    let items = items_of(store, sources.root, &project_dirs)?;
    let app_items = items_of(store, None, &app_dirs(sources.projects_dir))?;
    let db_bytes = database_bytes(sources.database);
    let project_warnings = if warn {
        evaluate(&items, None, thresholds)
    } else {
        vec![]
    };
    let app_warnings = if warn {
        evaluate(&app_items, Some(db_bytes), thresholds)
    } else {
        vec![]
    };

    Ok(StorageUsage {
        total_bytes: items.iter().map(|item| item.bytes).sum(),
        db_bytes,
        items,
        warnings: project_warnings,
        app: Scope {
            total_bytes: app_items.iter().map(|item| item.bytes).sum::<i64>() + db_bytes,
            items: app_items,
            warnings: app_warnings,
        },
    })
}

/// The warnings of `items` (and of the database file when its size is given): the highest level each kind reaches.
pub fn evaluate(
    items: &[UsageItem],
    db_bytes: Option<i64>,
    thresholds: &Thresholds,
) -> Vec<StorageWarning> {
    let database = db_bytes.map(|bytes| UsageItem {
        kind: "db",
        count: 0,
        bytes,
    });
    let mut warnings = Vec::new();

    for item in items.iter().chain(database.iter()) {
        let Some(limits) = thresholds.of(item.kind) else {
            continue;
        };
        let levels = [
            ("critical", limits.critical),
            ("warning", limits.warning),
            ("notice", limits.warning.scaled(NOTICE_PERCENT)),
        ];

        if let Some((level, limit)) = levels
            .into_iter()
            .find(|(_, limit)| limit.exceeded_by(item.count, item.bytes))
        {
            warnings.push(StorageWarning {
                kind: item.kind,
                level,
                count: item.count,
                bytes: item.bytes,
                threshold_bytes: limit.bytes,
                threshold_count: limit.count,
            });
        }
    }

    warnings
}

/// Counts and sizes of the rows of `root` (every project when none) and of the files under `dirs`.
fn items_of(
    store: &ActivityStore,
    root: Option<&str>,
    dirs: &[PathBuf],
) -> Result<Vec<UsageItem>, StorageError> {
    let (events, images, plans, history) = store
        .read(|connection| {
            let pair = |sql: &str| -> rusqlite::Result<(i64, i64)> {
                connection.query_row(sql, params![root], |row| Ok((row.get(0)?, row.get(1)?)))
            };

            Ok((
                pair(&format!("SELECT COUNT(*), COALESCE(SUM(LENGTH(project_root) + LENGTH(path) + COALESCE(LENGTH(old_path), 0) + {ROW_OVERHEAD_BYTES}), 0) FROM file_events WHERE (?1 IS NULL OR project_root = ?1)"))?,
                pair("SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) FROM chat_images WHERE (?1 IS NULL OR project_root = ?1)")?,
                pair(&format!("SELECT COUNT(*), COALESCE(SUM(LENGTH(project_root) + LENGTH(path) + LENGTH(title) + LENGTH(status) + LENGTH(format) + {ROW_OVERHEAD_BYTES}), 0) FROM plan_records WHERE (?1 IS NULL OR project_root = ?1)"))?,
                pair(&format!("SELECT COUNT(*), COALESCE(SUM(LENGTH(prompt) + LENGTH(answer) + COALESCE(LENGTH(error), 0) + COALESCE(LENGTH(steps), 0) + {ROW_OVERHEAD_BYTES}), 0) FROM chat_turns WHERE (?1 IS NULL OR workspace = ?1)"))?,
            ))
        })
        .map_err(|_| StorageError::ReadFailed)?;
    let (logs, session_plans) = dirs.iter().fold(((0, 0), (0, 0)), |(logs, plans), dir| {
        let (log_count, log_bytes) = folder_size(&dir.join("logs"), "log");
        let (plan_count, plan_bytes) = folder_size(&dir.join("plans"), "json");

        (
            (logs.0 + log_count, logs.1 + log_bytes),
            (plans.0 + plan_count, plans.1 + plan_bytes),
        )
    });
    let item = |kind, (count, bytes)| UsageItem { kind, count, bytes };

    Ok(vec![
        item("file_events", events),
        item("chat_images", images),
        item("plan_records", plans),
        item("run_logs", logs),
        item("chat_history", history),
        item("session_plans", session_plans),
    ])
}

/// The folders of every project in the app data.
fn app_dirs(projects_dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(projects_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect()
}

/// Count and total size of the regular files `*.<extension>` directly inside `folder`.
fn folder_size(folder: &Path, extension: &str) -> (i64, i64) {
    let mut count = 0;
    let mut total = 0;

    for entry in files_of(folder, extension) {
        count += 1;
        total += entry.1;
    }

    (count, total)
}

/// The regular files `*.<extension>` directly inside `folder`: path and size (links are skipped).
fn files_of(folder: &Path, extension: &str) -> Vec<(PathBuf, i64, Option<SystemTime>)> {
    fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let metadata = fs::symlink_metadata(entry.path()).ok()?;
            let path = entry.path();

            (metadata.is_file() && path.extension().is_some_and(|found| found == extension)).then(
                || {
                    (
                        path,
                        i64::try_from(metadata.len()).unwrap_or(i64::MAX),
                        metadata.modified().ok(),
                    )
                },
            )
        })
        .collect()
}

/// Size of the database file with its journal files.
fn database_bytes(database: &Path) -> i64 {
    ["", "-wal", "-shm"]
        .iter()
        .filter_map(|suffix| {
            let mut name = database.as_os_str().to_os_string();

            name.push(suffix);
            fs::metadata(PathBuf::from(name)).ok()
        })
        .map(|metadata| i64::try_from(metadata.len()).unwrap_or(i64::MAX))
        .sum()
}

/// Removes the data of `kind`: the rows of `root`, or the files of `sources.project_dir`; only those older than `older_than_days` when given. Nothing happens without `confirm`.
///
/// # Errors
/// `storage.confirm_required` without `confirm`, `storage.cleanup_failed` when a delete fails.
pub fn cleanup(
    store: &ActivityStore,
    kind: CleanupKind,
    sources: &Sources<'_>,
    older_than_days: Option<u32>,
    confirm: bool,
    now_seconds: i64,
) -> Result<Cleaned, StorageError> {
    if !confirm {
        return Err(StorageError::ConfirmRequired);
    }

    let cutoff = older_than_days.map_or(i64::MAX, |days| {
        now_seconds - i64::from(days) * i64::try_from(SECONDS_PER_DAY).unwrap_or(0)
    });

    match kind {
        CleanupKind::FileEvents => rows(
            store,
            sources,
            "file_events",
            "created_at",
            &format!("LENGTH(path) + COALESCE(LENGTH(old_path), 0) + {ROW_OVERHEAD_BYTES}"),
            cutoff,
        ),
        CleanupKind::ChatImages => rows(
            store,
            sources,
            "chat_images",
            "created_at",
            "size_bytes",
            cutoff,
        ),
        CleanupKind::PlanRecords => rows(
            store,
            sources,
            "plan_records",
            "updated_at",
            &format!("LENGTH(path) + LENGTH(title) + {ROW_OVERHEAD_BYTES}"),
            cutoff,
        ),
        CleanupKind::RunLogs => remove_files(
            sources.project_dir,
            "logs",
            "log",
            older_than_days,
            now_seconds,
        ),
        CleanupKind::SessionPlans => remove_files(
            sources.project_dir,
            "plans",
            "json",
            older_than_days,
            now_seconds,
        ),
    }
}

/// Deletes the rows of one project older than `cutoff`. `table`, `column` and `size` are fixed texts of this module.
fn rows(
    store: &ActivityStore,
    sources: &Sources<'_>,
    table: &str,
    column: &str,
    size: &str,
    cutoff: i64,
) -> Result<Cleaned, StorageError> {
    let root = sources.root.ok_or(StorageError::CleanupFailed)?;
    let bytes: i64 = store
        .read(|connection| {
            connection.query_row(
                &format!("SELECT COALESCE(SUM({size}), 0) FROM {table} WHERE project_root = ?1 AND {column} < ?2"),
                params![root, cutoff],
                |row| row.get(0),
            )
        })
        .map_err(|_| StorageError::CleanupFailed)?;
    let deleted = store.delete_older(table, column, root, Some(cutoff))?;

    Ok(Cleaned {
        deleted: i64::try_from(deleted).unwrap_or(0),
        bytes,
    })
}

/// Removes the regular files `*.<extension>` of `<project_dir>/<folder>` older than the limit; never a folder, never a link, never anything else.
fn remove_files(
    project_dir: Option<&Path>,
    folder: &str,
    extension: &str,
    older_than_days: Option<u32>,
    now_seconds: i64,
) -> Result<Cleaned, StorageError> {
    let dir = project_dir.ok_or(StorageError::CleanupFailed)?.join(folder);
    let oldest = older_than_days.and_then(|days| {
        let age = Duration::from_secs(u64::from(days) * SECONDS_PER_DAY);

        SystemTime::UNIX_EPOCH
            .checked_add(Duration::from_secs(u64::try_from(now_seconds).unwrap_or(0)))
            .and_then(|now| now.checked_sub(age))
    });
    let mut cleaned = Cleaned {
        deleted: 0,
        bytes: 0,
    };

    for (path, size, modified) in files_of(&dir, extension) {
        let old_enough = match (oldest, modified) {
            (None, _) => true,
            (Some(oldest), Some(modified)) => modified < oldest,
            (Some(_), None) => false,
        };

        if old_enough {
            fs::remove_file(&path).map_err(|_| StorageError::CleanupFailed)?;
            cleaned.deleted += 1;
            cleaned.bytes += size;
        }
    }

    Ok(cleaned)
}

#[cfg(test)]
#[path = "../tests/unit/storage.rs"]
mod tests;
