-- File edits made in the editor or by the AI: events only (path, kind, sizes), never the code, the diff, the prompt or the answer.
CREATE TABLE IF NOT EXISTS file_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_root TEXT NOT NULL,
    path TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create', 'save', 'delete', 'rename', 'copy', 'move', 'discard', 'ai_edit')),
    source TEXT NOT NULL CHECK (source IN ('user', 'ai')),
    bytes_after INTEGER,
    lines_added INTEGER,
    lines_removed INTEGER,
    old_path TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS file_events_project_created ON file_events (project_root, created_at);
CREATE INDEX IF NOT EXISTS file_events_project_path ON file_events (project_root, path);

-- Pictures pasted or attached in the chat, kept to look at again; one row per distinct content in a project.
CREATE TABLE IF NOT EXISTS chat_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_root TEXT NOT NULL,
    conversation_id INTEGER,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (project_root, sha256)
);
CREATE INDEX IF NOT EXISTS chat_images_project_created ON chat_images (project_root, created_at);

-- Index of the plan files of a project (the files in the project stay the source of truth): no plan text is kept here.
CREATE TABLE IF NOT EXISTS plan_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_root TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    tasks_total INTEGER NOT NULL DEFAULT 0,
    tasks_done INTEGER NOT NULL DEFAULT 0,
    format TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (project_root, path)
);
CREATE INDEX IF NOT EXISTS plan_records_project_updated ON plan_records (project_root, updated_at);
