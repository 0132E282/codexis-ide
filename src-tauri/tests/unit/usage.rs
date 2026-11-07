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

#[test]
fn huge_sizes_are_clamped_so_the_sums_do_not_overflow() {
    let store = store();

    record(&store, "claude", 0, i64::MAX, i64::MAX, None, None, 1_000).unwrap();
    record(&store, "claude", 0, i64::MAX, i64::MAX, None, None, 1_001).unwrap();
    record(&store, "claude", 0, -5, -5, None, None, 1_002).unwrap();

    let stats = store.stats(1_010, |_| 0).expect("stats stay readable");
    let claude = stats
        .clis
        .iter()
        .find(|usage| usage.cli == "claude")
        .unwrap();

    assert_eq!(
        claude.tokens_24h,
        2 * 2 * MAX_CHARACTERS / CHARACTERS_PER_TOKEN
    );
}
