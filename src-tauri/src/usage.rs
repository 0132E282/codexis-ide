//! Per-CLI usage statistics of the AI chat (turns in 24 hours / 7 days, estimated tokens, models, last use, limit errors).
//!
//! One row per finished turn in `usage_events`, in the same SQLite file as the chat history. Only sizes are kept, never the text of a prompt or an answer.

use crate::cli::CliKind;
use crate::profiles::ProfileStore;
use crate::sql;
use crate::{db, migrations};
use rusqlite::{params, Connection};
use sea_query::{Alias, Expr, ExprTrait, Func, Order, Query};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const DAY_SECONDS: i64 = 24 * 60 * 60;
const WEEK_SECONDS: i64 = 7 * DAY_SECONDS;
/// Estimated tokens: one token is about this many characters.
const CHARACTERS_PER_TOKEN: i64 = 4;
const MAX_MODEL_CHARACTERS: usize = 100;
const MAX_ERROR_CHARACTERS: usize = 500;
const MAX_EVENTS: i64 = 20_000;
/// Largest size one turn can report; keeps the `SUM` of 20 000 rows far from overflowing `i64`.
const MAX_CHARACTERS: i64 = 100_000_000;
const LIMIT_MARKERS: [&str; 9] = [
    "rate limit",
    "limit_reached",
    "rate_limit",
    "usage limit",
    "limit reached",
    "reached your limit",
    "hit your limit",
    "quota",
    "too many requests",
];
const UNAVAILABLE: &str = "usage.unavailable";
const INVALID: &str = "usage.invalid";

/// Whether a CLI error message says the account ran out of its allowance.
pub fn is_limit_error(message: &str) -> bool {
    let lower = message.to_lowercase();

    LIMIT_MARKERS.iter().any(|marker| lower.contains(marker))
}

/// Statistics of one CLI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUsage {
    pub cli: String,
    pub turns_24h: i64,
    pub turns_7d: i64,
    /// Unix seconds of the last turn.
    pub last_used_at: Option<i64>,
    pub models: Vec<String>,
    pub tokens_24h: i64,
    pub tokens_7d: i64,
    /// The last limit error is newer than the last successful turn.
    pub limit_reached: bool,
    /// Unix seconds of the last limit error.
    pub limit_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UsageStats {
    pub clis: Vec<CliUsage>,
}

/// One finished chat turn: sizes only, never the text.
#[derive(Debug, Clone, Copy)]
pub struct Turn<'a> {
    pub cli: &'a str,
    /// Account the turn ran under (0 = the CLI's own login).
    pub profile: i64,
    pub prompt_characters: i64,
    pub answer_characters: i64,
    pub model: Option<&'a str>,
    pub error: Option<&'a str>,
}

#[derive(Debug)]
pub struct UsageStore {
    connection: Connection,
}

impl UsageStore {
    /// Wraps a connection, creating the table when missing.
    ///
    /// # Errors
    /// Fails when the table cannot be created.
    pub fn new(connection: Connection) -> rusqlite::Result<Self> {
        connection.execute_batch(migrations::CREATE_USAGE_EVENTS_TABLE)?;
        migrations::apply_if_column_missing(
            &connection,
            "usage_events",
            "profile",
            migrations::ADD_PROFILE_TO_USAGE_EVENTS,
        )?;

        Ok(Self { connection })
    }

    /// Records a finished turn at `now` (unix seconds). `turn.error` is the CLI's error text, when it failed.
    ///
    /// # Errors
    /// Fails on an unknown CLI or when the database cannot be written.
    pub fn record(&self, turn: &Turn, now: i64) -> Result<bool, &'static str> {
        let Turn {
            cli,
            profile,
            prompt_characters,
            answer_characters,
            model,
            error,
        } = *turn;

        if CliKind::parse_agent(cli).is_none() {
            return Err(INVALID);
        }

        let model = model
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .map(|model| model.chars().take(MAX_MODEL_CHARACTERS).collect::<String>());
        let limited = error.is_some_and(|message| {
            is_limit_error(
                &message
                    .chars()
                    .take(MAX_ERROR_CHARACTERS)
                    .collect::<String>(),
            )
        });

        let mut insert = Query::insert();

        insert
            .into_table(Alias::new("usage_events"))
            .columns(
                [
                    "cli",
                    "profile",
                    "at",
                    "model",
                    "prompt_characters",
                    "answer_characters",
                    "failed",
                    "limited",
                ]
                .map(Alias::new),
            )
            .values_panic([
                cli.into(),
                profile.into(),
                now.into(),
                model.into(),
                prompt_characters.clamp(0, MAX_CHARACTERS).into(),
                answer_characters.clamp(0, MAX_CHARACTERS).into(),
                error.is_some().into(),
                limited.into(),
            ]);
        sql::execute(&self.connection, &insert).map_err(|_| UNAVAILABLE)?;
        self.connection
            .execute(
                "DELETE FROM usage_events WHERE id <= (SELECT MAX(id) FROM usage_events) - ?1",
                [MAX_EVENTS],
            )
            .map_err(|_| UNAVAILABLE)?;

        Ok(limited)
    }

    /// Statistics of every CLI as of `now` (unix seconds), counting only the account `profile_of` names for each CLI.
    ///
    /// # Errors
    /// Fails when the database cannot be read.
    pub fn stats(
        &self,
        now: i64,
        profile_of: impl Fn(&str) -> i64,
    ) -> Result<UsageStats, &'static str> {
        CliKind::AGENTS
            .iter()
            .map(|kind| {
                let cli = kind.name();
                self.cli_stats(cli, profile_of(cli), now)
                    .map_err(|_| UNAVAILABLE)
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|clis| UsageStats { clis })
    }

    fn cli_stats(&self, cli: &str, profile: i64, now: i64) -> rusqlite::Result<CliUsage> {
        let day_start = now - DAY_SECONDS;
        let week_start = now - WEEK_SECONDS;
        let (turns_24h, turns_7d, characters_24h, characters_7d, last_used_at, last_success, limit_at) =
            self.connection.query_row(
                "SELECT
                    COALESCE(SUM(at >= ?2), 0),
                    COUNT(*),
                    COALESCE(SUM(CASE WHEN at >= ?2 THEN prompt_characters + answer_characters END), 0),
                    COALESCE(SUM(prompt_characters + answer_characters), 0),
                    MAX(at),
                    MAX(CASE WHEN failed = 0 THEN at END),
                    MAX(CASE WHEN limited = 1 THEN at END)
                 FROM usage_events WHERE cli = ?1 AND at >= ?3 AND profile = ?4",
                params![cli, day_start, week_start, profile],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                        row.get::<_, Option<i64>>(6)?,
                    ))
                },
            )?;
        let models = sql::query_all(
            &self.connection,
            Query::select()
                .column(Alias::new("model"))
                .from(Alias::new("usage_events"))
                .and_where(Expr::col(Alias::new("cli")).eq(cli))
                .and_where(Expr::col(Alias::new("at")).gte(week_start))
                .and_where(Expr::col(Alias::new("profile")).eq(profile))
                .and_where(Expr::col(Alias::new("model")).is_not_null())
                .group_by_col(Alias::new("model"))
                .order_by_expr(Func::max(Expr::col(Alias::new("at"))).into(), Order::Desc),
            |row| row.get(0),
        )?;

        Ok(CliUsage {
            cli: cli.to_string(),
            turns_24h,
            turns_7d,
            last_used_at,
            models,
            tokens_24h: characters_24h / CHARACTERS_PER_TOKEN,
            tokens_7d: characters_7d / CHARACTERS_PER_TOKEN,
            limit_reached: limit_at
                .is_some_and(|at| last_success.is_none_or(|success| at > success)),
            limit_at,
        })
    }
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(0))
}

/// Called once at start-up with the database path: creates `usage_events` and manages the store.
///
/// # Errors
/// Fails when the table cannot be created.
pub fn setup(app: &tauri::App, database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;

    let connection = db::open(database).unwrap_or_else(|_| {
        eprintln!("database cannot be opened; usage statistics are kept in memory only");

        db::in_memory()
    });

    app.manage(Mutex::new(UsageStore::new(connection)?));

    Ok(())
}

/// Records a finished chat turn (sizes only, not the text); resolves to whether the turn ended on a limit error, so the chat can move to the next AI.
#[tauri::command]
pub fn usage_record(
    state: State<'_, Mutex<UsageStore>>,
    profiles: State<'_, ProfileStore>,
    cli: String,
    prompt_characters: i64,
    answer_characters: i64,
    model: Option<String>,
    error: Option<String>,
) -> Result<bool, String> {
    let store = state.lock().map_err(|_| UNAVAILABLE.to_string())?;

    store
        .record(
            &Turn {
                cli: &cli,
                profile: profiles.active_id(&cli),
                prompt_characters,
                answer_characters,
                model: model.as_deref(),
                error: error.as_deref(),
            },
            now_seconds(),
        )
        .map_err(str::to_string)
}

#[tauri::command]
pub fn usage_stats(
    state: State<'_, Mutex<UsageStore>>,
    profiles: State<'_, ProfileStore>,
) -> Result<UsageStats, String> {
    let store = state.lock().map_err(|_| UNAVAILABLE.to_string())?;

    store
        .stats(now_seconds(), |cli| profiles.active_id(cli))
        .map_err(str::to_string)
}

/// Statistics of one account `profile` of `cli`, whether or not it is the active one.
#[tauri::command]
pub fn usage_stats_profile(
    state: State<'_, Mutex<UsageStore>>,
    cli: String,
    profile: i64,
) -> Result<CliUsage, String> {
    let store = state.lock().map_err(|_| UNAVAILABLE.to_string())?;

    if CliKind::parse_agent(&cli).is_none() {
        return Err(UNAVAILABLE.to_string());
    }

    store
        .cli_stats(&cli, profile, now_seconds())
        .map_err(|_| UNAVAILABLE.to_string())
}

#[cfg(test)]
#[path = "../tests/unit/usage.rs"]
mod tests;
