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
    migrations::apply_if_column_missing(
        &connection,
        "things",
        "flag",
        "ALTER TABLE things ADD COLUMN flag INTEGER NOT NULL DEFAULT 7",
    )
    .unwrap();

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
    migrations::apply_if_column_missing(
        &connection,
        "things",
        "flag",
        "ALTER TABLE things ADD COLUMN flag INTEGER NOT NULL DEFAULT 7",
    )
    .unwrap();
    migrations::apply_if_column_missing(
        &connection,
        "things",
        "flag",
        "ALTER TABLE things ADD COLUMN flag INTEGER NOT NULL DEFAULT 7",
    )
    .unwrap();

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

#[test]
fn the_old_database_file_is_renamed_with_its_data_and_never_overwrites_a_new_one() {
    let dir = TempDir::new().unwrap();

    fs::write(dir.path().join("rynox.db"), b"old").unwrap();
    fs::write(dir.path().join("rynox.db-wal"), b"old-wal").unwrap();
    move_legacy_file(dir.path());
    assert_eq!(fs::read(dir.path().join("codexis.db")).unwrap(), b"old");
    assert_eq!(
        fs::read(dir.path().join("codexis.db-wal")).unwrap(),
        b"old-wal"
    );
    assert!(!dir.path().join("rynox.db").exists());

    // * A new file already there stays as it is; the old one is left alone.
    fs::write(dir.path().join("rynox.db"), b"older").unwrap();
    move_legacy_file(dir.path());
    assert_eq!(fs::read(dir.path().join("codexis.db")).unwrap(), b"old");
    assert_eq!(fs::read(dir.path().join("rynox.db")).unwrap(), b"older");

    // * Nothing to move: no file is made.
    let empty = TempDir::new().unwrap();

    move_legacy_file(empty.path());
    assert!(!empty.path().join("codexis.db").exists());
}
