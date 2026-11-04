//! Per-CLI usage statistics of the AI chat (turns in 24 hours / 7 days, estimated tokens, models, last use, limit errors).
//!
//! One row per finished turn in `usage_events`, in the same SQLite file as the chat history. Only sizes are kept, never the text of a prompt or an answer.

use crate::agent::Cli;
use crate::db;
use crate::profiles::ProfileStore;
use rusqlite::{params, Connection};
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
const CLI_NAMES: [&str; 2] = ["claude", "codex"];
const LIMIT_MARKERS: [&str; 8] = [
    "rate limit",
    "rate_limit",
    "usage limit",
    "limit reached",
    "reached your limit",
    "hit your limit",
    "quota",
    "too many requests",
];
const UNAVAILABLE: &str = "Không đọc được thống kê AI.";
const INVALID: &str = "Dữ liệu thống kê AI không hợp lệ.";

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cli TEXT NOT NULL,
        at INTEGER NOT NULL,
        model TEXT,
        prompt_characters INTEGER NOT NULL,
        answer_characters INTEGER NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0,
        limited INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS usage_events_cli_at ON usage_events (cli, at);
";

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
        connection.execute_batch(SCHEMA)?;
        add_profile_column(&connection)?;

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

        if Cli::parse(cli).is_none() {
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

        self.connection
            .execute(
                "INSERT INTO usage_events (cli, profile, at, model, prompt_characters, answer_characters, failed, limited) VALUES (?1, ?8, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    cli,
                    now,
                    model,
                    prompt_characters.max(0),
                    answer_characters.max(0),
                    error.is_some(),
                    limited,
                    profile
                ],
            )
            .map_err(|_| UNAVAILABLE)?;
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
        CLI_NAMES
            .iter()
            .map(|cli| {
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
        let mut statement = self.connection.prepare(
            "SELECT model FROM usage_events WHERE cli = ?1 AND at >= ?2 AND profile = ?3 AND model IS NOT NULL GROUP BY model ORDER BY MAX(at) DESC",
        )?;
        let models = statement
            .query_map(params![cli, week_start, profile], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;

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

/// Files made before accounts could be switched lack the column; their turns belong to the default account (0).
fn add_profile_column(connection: &Connection) -> rusqlite::Result<()> {
    let has_column = connection
        .prepare("SELECT 1 FROM pragma_table_info('usage_events') WHERE name = 'profile'")?
        .exists([])?;

    if !has_column {
        connection.execute(
            "ALTER TABLE usage_events ADD COLUMN profile INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    Ok(())
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

    if !CLI_NAMES.contains(&cli.as_str()) {
        return Err(UNAVAILABLE.to_string());
    }

    store
        .cli_stats(&cli, profile, now_seconds())
        .map_err(|_| UNAVAILABLE.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> UsageStore {
        UsageStore::new(db::in_memory()).expect("store")
    }

    /// Records a turn with the sizes given; keeps the tests short.
    #[allow(clippy::too_many_arguments)]
    fn record(
        store: &UsageStore,
        cli: &str,
        profile: i64,
        prompt_characters: i64,
        answer_characters: i64,
        model: Option<&str>,
        error: Option<&str>,
        now: i64,
    ) -> Result<bool, &'static str> {
        store.record(
            &Turn {
                cli,
                profile,
                prompt_characters,
                answer_characters,
                model,
                error,
            },
            now,
        )
    }

    #[test]
    fn record_tells_whether_the_turn_hit_a_limit() {
        let store = store();

        assert_eq!(
            record(
                &store,
                "claude",
                0,
                1,
                1,
                None,
                Some("You've hit your limit"),
                10
            ),
            Ok(true)
        );
        assert_eq!(
            record(&store, "claude", 0, 1, 1, None, Some("boom"), 20),
            Ok(false)
        );
        assert_eq!(record(&store, "claude", 0, 1, 1, None, None, 30), Ok(false));
    }

    #[test]
    fn counts_windows_tokens_and_models() {
        let store = store();
        let now = 1_000_000;

        record(&store, "claude", 0, 40, 40, Some("opus"), None, now - 100).unwrap();
        record(
            &store,
            "claude",
            0,
            80,
            0,
            Some("sonnet"),
            None,
            now - 2 * DAY_SECONDS,
        )
        .unwrap();
        record(
            &store,
            "claude",
            0,
            400,
            0,
            None,
            None,
            now - 8 * DAY_SECONDS,
        )
        .unwrap();

        let claude = &store.stats(now, |_| 0).unwrap().clis[0];

        assert_eq!(claude.cli, "claude");
        assert_eq!((claude.turns_24h, claude.turns_7d), (1, 2));
        assert_eq!((claude.tokens_24h, claude.tokens_7d), (20, 40));
        assert_eq!(claude.last_used_at, Some(now - 100));
        assert_eq!(claude.models, ["opus", "sonnet"]);
        assert!(!claude.limit_reached);

        let codex = &store.stats(now, |_| 0).unwrap().clis[1];

        assert_eq!((codex.turns_7d, codex.last_used_at), (0, None));
    }

    #[test]
    fn limit_error_counts_until_a_later_success() {
        let store = store();
        let now = 1_000_000;

        record(
            &store,
            "codex",
            0,
            4,
            0,
            None,
            Some("You hit your usage limit"),
            now - 50,
        )
        .unwrap();
        assert!(store.stats(now, |_| 0).unwrap().clis[1].limit_reached);

        record(
            &store,
            "codex",
            0,
            4,
            4,
            None,
            Some("network down"),
            now - 40,
        )
        .unwrap();
        assert!(store.stats(now, |_| 0).unwrap().clis[1].limit_reached);

        record(&store, "codex", 0, 4, 4, None, None, now - 10).unwrap();

        let codex = &store.stats(now, |_| 0).unwrap().clis[1];

        assert!(!codex.limit_reached);
        assert_eq!(codex.limit_at, Some(now - 50));
    }

    #[test]
    fn statistics_follow_the_chosen_account() {
        let store = store();
        let now = 1_000_000;

        record(&store, "claude", 0, 40, 0, None, None, now - 10).unwrap();
        record(&store, "claude", 7, 80, 0, None, None, now - 5).unwrap();
        record(&store, "claude", 7, 80, 0, None, None, now - 4).unwrap();

        let of = |profile: i64| store.stats(now, move |_| profile).unwrap().clis[0].turns_7d;

        assert_eq!((of(0), of(7), of(9)), (1, 2, 0));
    }

    #[test]
    fn old_files_without_the_column_count_for_the_default_account() {
        let connection = Connection::open_in_memory().unwrap();

        connection
            .execute_batch(
                "CREATE TABLE usage_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, cli TEXT NOT NULL, at INTEGER NOT NULL,
                    model TEXT, prompt_characters INTEGER NOT NULL, answer_characters INTEGER NOT NULL,
                    failed INTEGER NOT NULL DEFAULT 0, limited INTEGER NOT NULL DEFAULT 0
                 );
                 INSERT INTO usage_events (cli, at, prompt_characters, answer_characters) VALUES ('claude', 999990, 4, 4);",
            )
            .unwrap();

        let store = UsageStore::new(connection).unwrap();

        assert_eq!(store.stats(1_000_000, |_| 0).unwrap().clis[0].turns_7d, 1);
    }

    #[test]
    fn rejects_unknown_cli() {
        assert!(record(&store(), "gemini", 0, 1, 1, None, None, 1).is_err());
    }

    #[test]
    fn detects_limit_messages() {
        assert!(is_limit_error("Error: 429 Too Many Requests"));
        assert!(is_limit_error("Claude AI usage limit reached"));
        assert!(!is_limit_error("file not found"));
    }
}
