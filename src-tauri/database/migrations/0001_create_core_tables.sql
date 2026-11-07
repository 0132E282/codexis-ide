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
