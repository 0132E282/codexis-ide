//! SQL migrations of the one SQLite file, kept in `database/migrations/` and embedded at build time.
//!
//! Every file is idempotent (`IF NOT EXISTS`) or guarded by [`apply_if_column_missing`], so running them again on an existing file keeps its data.

use rusqlite::Connection;

pub const CREATE_CORE_TABLES: &str =
    include_str!("../database/migrations/0001_create_core_tables.sql");
pub const CREATE_CREDENTIALS_TABLE: &str =
    include_str!("../database/migrations/0002_create_credentials_table.sql");
pub const CREATE_PROFILES_TABLES: &str =
    include_str!("../database/migrations/0003_create_profiles_tables.sql");
pub const CREATE_SETTINGS_TABLE: &str =
    include_str!("../database/migrations/0004_create_settings_table.sql");
pub const CREATE_USAGE_EVENTS_TABLE: &str =
    include_str!("../database/migrations/0005_create_usage_events_table.sql");
pub const ADD_ARCHIVED_TO_CHAT_TURNS: &str =
    include_str!("../database/migrations/0006_add_archived_to_chat_turns.sql");
pub const ADD_CONVERSATION_TO_CHAT_TURNS: &str =
    include_str!("../database/migrations/0007_add_conversation_to_chat_turns.sql");
pub const ADD_STEPS_TO_CHAT_TURNS: &str =
    include_str!("../database/migrations/0008_add_steps_to_chat_turns.sql");
pub const ADD_PROFILE_TO_USAGE_EVENTS: &str =
    include_str!("../database/migrations/0009_add_profile_to_usage_events.sql");
pub const CREATE_CHAT_GRID_TABLE: &str =
    include_str!("../database/migrations/0010_create_chat_grid_table.sql");
pub const CREATE_ACTIVITY_TABLES: &str =
    include_str!("../database/migrations/0011_create_activity_tables.sql");

/// Runs the `ALTER TABLE` in `migration` when a file made by an older version lacks `column` in `table`.
///
/// `table` and `column` are fixed names written in this crate, never user input.
///
/// # Errors
/// Fails when the table cannot be inspected or the migration cannot run.
pub fn apply_if_column_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    migration: &str,
) -> rusqlite::Result<()> {
    let has_column = connection
        .prepare("SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2")?
        .exists([table, column])?;

    if !has_column {
        connection.execute_batch(migration)?;
    }

    Ok(())
}
