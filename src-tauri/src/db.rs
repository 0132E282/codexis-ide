//! The one SQLite file of the IDE (saved projects and chat history) in the app data folder.
//!
//! The file may hold environment values, so it is owner-only on Unix. A file that is not a database is moved aside (`*.corrupt`) and replaced by a new one, so the IDE still starts.

use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// Environment variable naming the database file (falls back to `rynox.db` in the app data folder).
pub const DB_ENV: &str = "RYNOX_DB";

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        folders TEXT NOT NULL,
        env TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_turns (
        workspace TEXT NOT NULL,
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        cli TEXT NOT NULL,
        prompt TEXT NOT NULL,
        answer TEXT NOT NULL,
        error TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace, id)
    );
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace TEXT NOT NULL,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_sessions (
        conversation INTEGER NOT NULL,
        cli TEXT NOT NULL,
        session TEXT NOT NULL,
        PRIMARY KEY (conversation, cli)
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
        workspace TEXT NOT NULL,
        cli TEXT NOT NULL,
        session TEXT NOT NULL,
        PRIMARY KEY (workspace, cli)
    );
";

/// The database file: `RYNOX_DB` when set and not empty, else `rynox.db` inside `data_dir`.
pub fn path(data_dir: &Path) -> PathBuf {
    std::env::var_os(DB_ENV)
        .filter(|value| !value.is_empty())
        .map_or_else(|| data_dir.join("rynox.db"), PathBuf::from)
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

    connection.execute_batch(SCHEMA)?;
    add_archived_column(&connection)?;
    add_conversation_column(&connection)?;
    group_old_turns(&connection)?;

    // The file may hold secrets: owner only.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(connection)
}

/// Adds `column` to `table` (with its `definition`) when a file made by an older version lacks it.
///
/// `table`, `column` and `definition` are fixed names written in this file, never user input.
fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    let has_column = connection
        .prepare("SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2")?
        .exists([table, column])?;

    if !has_column {
        connection.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }

    Ok(())
}

/// Files made before conversations could be archived lack the column.
fn add_archived_column(connection: &Connection) -> rusqlite::Result<()> {
    add_column_if_missing(
        connection,
        "chat_turns",
        "archived",
        "INTEGER NOT NULL DEFAULT 0",
    )
}

/// Files made before conversations were listed lack the column.
fn add_conversation_column(connection: &Connection) -> rusqlite::Result<()> {
    add_column_if_missing(
        connection,
        "chat_turns",
        "conversation",
        "INTEGER NOT NULL DEFAULT 0",
    )
}

/// Turns saved before conversations were listed (conversation 0) are grouped: each workspace's current turns become one conversation (with its CLI session ids), its archived turns another.
fn group_old_turns(connection: &Connection) -> rusqlite::Result<()> {
    let mut groups = connection
        .prepare("SELECT DISTINCT workspace, archived FROM chat_turns WHERE conversation = 0")?;
    let groups = groups
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for (workspace, archived) in groups {
        let title: String = if archived == 0 {
            connection
                .query_row(
                    "SELECT prompt FROM chat_turns WHERE workspace = ?1 AND archived = 0 AND conversation = 0 ORDER BY position LIMIT 1",
                    [&workspace],
                    |row| row.get::<_, String>(0),
                )
                .map(|prompt| crate::chats::title_of(&prompt))
                .unwrap_or_default()
        } else {
            "Cuộc trò chuyện cũ".to_string()
        };

        connection.execute(
            "INSERT INTO conversations (workspace, title, updated_at) VALUES (?1, ?2, CAST(strftime('%s', 'now') AS INTEGER) - ?3)",
            rusqlite::params![workspace, title, archived],
        )?;

        let conversation = connection.last_insert_rowid();

        connection.execute(
            "UPDATE chat_turns SET conversation = ?1 WHERE workspace = ?2 AND archived = ?3 AND conversation = 0",
            rusqlite::params![conversation, workspace, archived],
        )?;

        if archived == 0 {
            connection.execute(
                "INSERT OR REPLACE INTO conversation_sessions (conversation, cli, session) SELECT ?1, cli, session FROM chat_sessions WHERE workspace = ?2",
                rusqlite::params![conversation, workspace],
            )?;
        }
    }

    Ok(())
}

/// Used when the file cannot be opened at all: the IDE keeps working, nothing is kept after it closes.
pub fn in_memory() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory database");

    connection.execute_batch(SCHEMA).expect("schema");
    add_archived_column(&connection).expect("schema");

    connection
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn column_exists(connection: &Connection, table: &str, column: &str) -> bool {
        connection
            .prepare("SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2")
            .unwrap()
            .exists([table, column])
            .unwrap()
    }

    #[test]
    fn missing_column_is_added_with_its_default() {
        let connection = Connection::open_in_memory().unwrap();

        connection
            .execute_batch("CREATE TABLE things (id INTEGER); INSERT INTO things VALUES (1);")
            .unwrap();
        add_column_if_missing(&connection, "things", "flag", "INTEGER NOT NULL DEFAULT 7").unwrap();

        let flag: i64 = connection
            .query_row("SELECT flag FROM things", [], |row| row.get(0))
            .unwrap();

        assert_eq!(flag, 7);
    }

    #[test]
    fn adding_an_existing_column_twice_keeps_the_rows() {
        let connection = Connection::open_in_memory().unwrap();

        connection
            .execute_batch("CREATE TABLE things (id INTEGER); INSERT INTO things VALUES (1);")
            .unwrap();
        add_column_if_missing(&connection, "things", "flag", "INTEGER NOT NULL DEFAULT 7").unwrap();
        add_column_if_missing(&connection, "things", "flag", "INTEGER NOT NULL DEFAULT 7").unwrap();

        let rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM things", [], |row| row.get(0))
            .unwrap();

        assert_eq!(rows, 1);
    }

    #[test]
    fn old_chat_turns_are_upgraded_and_grouped_into_a_conversation() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("old.db");
        let old = Connection::open(&file).unwrap();

        old.execute_batch(
            "CREATE TABLE chat_turns (
                workspace TEXT NOT NULL,
                id TEXT NOT NULL,
                position INTEGER NOT NULL,
                cli TEXT NOT NULL,
                prompt TEXT NOT NULL,
                answer TEXT NOT NULL,
                error TEXT,
                PRIMARY KEY (workspace, id)
            );
            INSERT INTO chat_turns VALUES ('w', 't1', 0, 'claude', 'hello', 'hi', NULL);
            INSERT INTO chat_turns VALUES ('w', 't2', 1, 'claude', 'again', 'yes', NULL);",
        )
        .unwrap();
        drop(old);

        let connection = open(&file).unwrap();

        assert!(column_exists(&connection, "chat_turns", "archived"));
        assert!(column_exists(&connection, "chat_turns", "conversation"));

        let (turns, groups): (i64, i64) = connection
            .query_row(
                "SELECT COUNT(*), COUNT(DISTINCT conversation) FROM chat_turns WHERE conversation != 0",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let conversations: i64 = connection
            .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
            .unwrap();

        assert_eq!((turns, groups, conversations), (2, 1, 1));
    }
}
