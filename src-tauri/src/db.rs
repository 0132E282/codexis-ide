//! The one SQLite file of the IDE (saved projects and chat history) in the app data folder.
//!
//! The file may hold environment values, so it is owner-only on Unix. A file that is not a database is moved aside (`*.corrupt`) and replaced by a new one, so the IDE still starts.

use crate::{migrations, sql};
use rusqlite::Connection;
use sea_query::{Alias, Expr, ExprTrait, Order, Query};
use std::fs;
use std::path::{Path, PathBuf};

/// Environment variable naming the database file (falls back to `codexis.db` in the app data folder).
pub const DB_ENV: &str = "RYNOX_DB";

/// Name of the database file in the app data folder.
const FILE_NAME: &str = "codexis.db";

/// Name the file had before the IDE was renamed; a file under it is moved to `FILE_NAME`.
const LEGACY_FILE_NAME: &str = "rynox.db";

/// The database file: `RYNOX_DB` when set and not empty, else `codexis.db` inside `data_dir`.
///
/// A `rynox.db` left by an earlier version is renamed to `codexis.db` (with its `-wal` and `-shm` files) when there is no `codexis.db` yet, so the saved projects and chats come along. Nothing is deleted or overwritten.
pub fn path(data_dir: &Path) -> PathBuf {
    std::env::var_os(DB_ENV)
        .filter(|value| !value.is_empty())
        .map_or_else(
            || {
                move_legacy_file(data_dir);
                data_dir.join(FILE_NAME)
            },
            PathBuf::from,
        )
}

/// Renames the old database file (and its journal files) to the new name, only when the new one does not exist.
fn move_legacy_file(data_dir: &Path) {
    let current = data_dir.join(FILE_NAME);
    let legacy = data_dir.join(LEGACY_FILE_NAME);

    if current.exists() || !legacy.exists() {
        return;
    }

    for suffix in ["", "-wal", "-shm"] {
        let from = data_dir.join(format!("{LEGACY_FILE_NAME}{suffix}"));
        let to = data_dir.join(format!("{FILE_NAME}{suffix}"));

        // Best effort: when the rename fails the new file is made empty, and the old one stays where it was.
        if from.exists() {
            let _ = fs::rename(from, to);
        }
    }
}

/// Opens (creating it when missing) the database at `path` with the tables in place.
///
/// # Errors
/// Fails when the folder or the file cannot be created, or the file is still not a database after being moved aside.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        // A failure shows up as the open error below.
        let _ = fs::create_dir_all(parent);
    }

    match prepare(path) {
        Ok(connection) => Ok(connection),
        Err(_) if path.exists() => {
            eprintln!("database file is not usable; moved aside");
            // Best effort: if the rename fails the second attempt fails too and the caller falls back.
            let _ = fs::rename(path, path.with_extension("db.corrupt"));

            prepare(path)
        }
        Err(error) => Err(error),
    }
}

fn prepare(path: &Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open(path)?;

    connection.execute_batch(migrations::CREATE_CORE_TABLES)?;
    connection.execute_batch(migrations::CREATE_CHAT_GRID_TABLE)?;
    add_archived_column(&connection)?;
    add_conversation_column(&connection)?;
    add_steps_column(&connection)?;
    add_context_column(&connection)?;
    connection.execute_batch(migrations::ADD_CONVERSATION_INDEX_TO_CHAT_TURNS)?;
    group_old_turns(&connection)?;

    // The file may hold secrets: owner only.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(connection)
}

/// Files made before conversations could be archived lack the column.
fn add_archived_column(connection: &Connection) -> rusqlite::Result<()> {
    migrations::apply_if_column_missing(
        connection,
        "chat_turns",
        "archived",
        migrations::ADD_ARCHIVED_TO_CHAT_TURNS,
    )
}

/// Files made before conversations were listed lack the column.
fn add_conversation_column(connection: &Connection) -> rusqlite::Result<()> {
    migrations::apply_if_column_missing(
        connection,
        "chat_turns",
        "conversation",
        migrations::ADD_CONVERSATION_TO_CHAT_TURNS,
    )
}

/// Files made before the steps of the AI were kept lack the column.
fn add_steps_column(connection: &Connection) -> rusqlite::Result<()> {
    migrations::apply_if_column_missing(
        connection,
        "chat_turns",
        "steps",
        migrations::ADD_STEPS_TO_CHAT_TURNS,
    )
}

/// Files made before the context usage of a turn was kept lack the column.
fn add_context_column(connection: &Connection) -> rusqlite::Result<()> {
    migrations::apply_if_column_missing(
        connection,
        "chat_turns",
        "context",
        migrations::ADD_CONTEXT_TO_CHAT_TURNS,
    )
}

/// Turns saved before conversations were listed (conversation 0) are grouped: each workspace's current turns become one conversation (with its CLI session ids), its archived turns another.
fn group_old_turns(connection: &Connection) -> rusqlite::Result<()> {
    let groups = sql::query_all(
        connection,
        Query::select()
            .distinct()
            .columns([Alias::new("workspace"), Alias::new("archived")])
            .from(Alias::new("chat_turns"))
            .and_where(Expr::col(Alias::new("conversation")).eq(0_i64)),
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )?;

    for (workspace, archived) in groups {
        let title: String = if archived == 0 {
            sql::query_first(
                connection,
                Query::select()
                    .column(Alias::new("prompt"))
                    .from(Alias::new("chat_turns"))
                    .and_where(Expr::col(Alias::new("workspace")).eq(workspace.as_str()))
                    .and_where(Expr::col(Alias::new("archived")).eq(0_i64))
                    .and_where(Expr::col(Alias::new("conversation")).eq(0_i64))
                    .order_by(Alias::new("position"), Order::Asc)
                    .limit(1),
                |row| row.get::<_, String>(0),
            )?
            .map(|prompt| crate::chats::title_of(&prompt))
            .unwrap_or_default()
        } else {
            "Cuộc trò chuyện cũ".to_string()
        };

        let mut insert = Query::insert();

        insert
            .into_table(Alias::new("conversations"))
            .columns([
                Alias::new("workspace"),
                Alias::new("title"),
                Alias::new("updated_at"),
            ])
            .values_panic([
                workspace.as_str().into(),
                title.into(),
                Expr::cust_with_values("CAST(strftime('%s', 'now') AS INTEGER) - ?", [archived]),
            ]);
        sql::execute(connection, &insert)?;

        let conversation = connection.last_insert_rowid();

        sql::execute(
            connection,
            Query::update()
                .table(Alias::new("chat_turns"))
                .value(Alias::new("conversation"), conversation)
                .and_where(Expr::col(Alias::new("workspace")).eq(workspace.as_str()))
                .and_where(Expr::col(Alias::new("archived")).eq(archived))
                .and_where(Expr::col(Alias::new("conversation")).eq(0_i64)),
        )?;

        if archived == 0 {
            let mut sessions = Query::select();

            sessions
                .expr(Expr::val(conversation))
                .columns([Alias::new("cli"), Alias::new("session")])
                .from(Alias::new("chat_sessions"))
                .and_where(Expr::col(Alias::new("workspace")).eq(workspace.as_str()));

            let mut copy = Query::insert();

            copy.replace()
                .into_table(Alias::new("conversation_sessions"))
                .columns([
                    Alias::new("conversation"),
                    Alias::new("cli"),
                    Alias::new("session"),
                ])
                .select_from(sessions)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            sql::execute(connection, &copy)?;
        }
    }

    Ok(())
}

/// Used when the file cannot be opened at all: the IDE keeps working, nothing is kept after it closes.
pub fn in_memory() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory database");

    connection
        .execute_batch(migrations::CREATE_CORE_TABLES)
        .expect("schema");
    connection
        .execute_batch(migrations::CREATE_CHAT_GRID_TABLE)
        .expect("schema");
    add_archived_column(&connection).expect("schema");
    add_conversation_column(&connection).expect("schema");
    add_steps_column(&connection).expect("schema");
    add_context_column(&connection).expect("schema");
    connection
        .execute_batch(migrations::ADD_CONVERSATION_INDEX_TO_CHAT_TURNS)
        .expect("schema");

    connection
}

#[cfg(test)]
#[path = "../tests/unit/db.rs"]
mod tests;
