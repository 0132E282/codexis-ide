//! Seeders: data written into the database once, tracked by a flag in the `meta` table.
//!
//! There is no static seed data (see `database/seeders/`); the only seed is the import of the old `projects.json`, run by `ProjectStore`.

use crate::sql;
use rusqlite::Connection;
use sea_query::Value;

/// Whether the seed `name` already ran.
pub fn is_done(connection: &Connection, name: &str) -> bool {
    sql::find_by_key(connection, "meta", &["value"], "key", name, |_| Ok(()))
        .is_ok_and(|row| row.is_some())
}

/// Records that the seed `name` ran, so it is not run again.
pub fn mark_done(connection: &Connection, name: &str) {
    // Best effort: without the flag the seed is only tried again at the next start.
    let _ = sql::upsert(
        connection,
        "meta",
        &["key"],
        vec![("key", Value::from(name)), ("value", Value::from("1"))],
    );
}
