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
