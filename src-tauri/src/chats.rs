//! Chat history of the AI panel, kept in the SQLite file next to the saved projects (see `db`).
//!
//! History belongs to a workspace (its root path) and is split into conversations, as the Claude CLI splits its sessions: each conversation has a title taken from its first message, a last-used time, its turns and the session id of each CLI, so opening it again continues the same `claude` / `codex` conversation.

use crate::agent::Cli;
use crate::db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

/// Oldest turns beyond this many per workspace are dropped.
pub const MAX_TURNS: i64 = 500;
const MAX_ID_BYTES: usize = 64;
const MAX_PROMPT_BYTES: usize = 200_000;
const MAX_ANSWER_BYTES: usize = 2_000_000;
const MAX_STEPS_BYTES: usize = 4_000_000;
const MAX_SESSION_BYTES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatError {
    Invalid,
    SaveFailed,
    LoadFailed,
}

impl ChatError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::Invalid => "Dữ liệu cuộc trò chuyện không hợp lệ.",
            Self::SaveFailed => "Không lưu được cuộc trò chuyện.",
            Self::LoadFailed => "Không đọc được cuộc trò chuyện đã lưu.",
        }
    }
}

impl fmt::Display for ChatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ChatError {}

pub type Result<T> = std::result::Result<T, ChatError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatTurn {
    pub id: String,
    /// `claude` or `codex`: the CLI that answered.
    pub cli: String,
    pub prompt: String,
    pub answer: String,
    pub error: Option<String>,
    /// What the AI did during the turn, as the JSON the UI made; stored as is.
    #[serde(default)]
    pub steps: Option<String>,
}

const MAX_TITLE_CHARS: usize = 60;

/// Title of a conversation: the first line of its first message, cut to a short length.
pub fn title_of(prompt: &str) -> String {
    let line = prompt
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('@'))
        .unwrap_or_default();
    let mut title: String = line.chars().take(MAX_TITLE_CHARS).collect();

    if line.chars().count() > MAX_TITLE_CHARS {
        title.push('…');
    }

    title
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
pub struct ChatHistory {
    /// Id of the conversation these turns belong to.
    pub conversation: i64,
    pub turns: Vec<ChatTurn>,
    /// CLI name → session id to pass back so the next turn continues that CLI's conversation.
    pub sessions: HashMap<String, String>,
}

/// One entry of the conversation list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: i64,
    pub title: String,
    /// Unix seconds of the last saved turn.
    pub updated_at: i64,
    pub turns: i64,
}

#[derive(Debug)]
pub struct ChatStore {
    connection: Connection,
}

impl ChatStore {
    /// Opens the database; when it cannot be opened the history lives in memory only.
    pub fn open(path: PathBuf) -> Self {
        let connection = db::open(&path).unwrap_or_else(|_| {
            eprintln!("database cannot be opened; chat history is kept in memory only");

            db::in_memory()
        });

        Self { connection }
    }

    fn owns(&self, workspace: &str, conversation: i64) -> bool {
        self.connection
            .query_row(
                "SELECT 1 FROM conversations WHERE id = ?1 AND workspace = ?2",
                params![conversation, workspace],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
    }

    /// Conversations of `workspace` that have at least one turn, the most recently used first.
    ///
    /// # Errors
    /// Fails when the database cannot be read.
    pub fn list(&self, workspace: &str) -> Result<Vec<Conversation>> {
        let read = || -> rusqlite::Result<Vec<Conversation>> {
            let mut statement = self.connection.prepare(
                "SELECT c.id, c.title, c.updated_at, COUNT(t.id)
                 FROM conversations c JOIN chat_turns t ON t.conversation = c.id
                 WHERE c.workspace = ?1
                 GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC",
            )?;

            let rows = statement
                .query_map([workspace], |row| {
                    Ok(Conversation {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        updated_at: row.get(2)?,
                        turns: row.get(3)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>();

            rows
        };

        read().map_err(|_| ChatError::LoadFailed)
    }

    /// Turns (oldest first) and CLI session ids of `conversation`, or of the most recent conversation of `workspace` when none is named; an empty one is made when the workspace has none yet.
    ///
    /// # Errors
    /// Fails on a conversation of another workspace or when the database cannot be read.
    pub fn load(&mut self, workspace: &str, conversation: Option<i64>) -> Result<ChatHistory> {
        if workspace.is_empty() {
            return Err(ChatError::Invalid);
        }

        let id = match conversation {
            Some(id) if self.owns(workspace, id) => id,
            Some(_) => return Err(ChatError::Invalid),
            None => match self.list(workspace)?.first() {
                Some(latest) => latest.id,
                None => self.new_conversation(workspace)?,
            },
        };
        let read = || -> rusqlite::Result<ChatHistory> {
            let mut turns = self.connection.prepare(
                "SELECT id, cli, prompt, answer, error, steps FROM chat_turns WHERE conversation = ?1 ORDER BY position",
            )?;
            let turns = turns
                .query_map([id], |row| {
                    Ok(ChatTurn {
                        id: row.get(0)?,
                        cli: row.get(1)?,
                        prompt: row.get(2)?,
                        answer: row.get(3)?,
                        error: row.get(4)?,
                        steps: row.get(5)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut sessions = self.connection.prepare(
                "SELECT cli, session FROM conversation_sessions WHERE conversation = ?1",
            )?;
            let sessions = sessions
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<rusqlite::Result<HashMap<String, String>>>()?;

            Ok(ChatHistory {
                conversation: id,
                turns,
                sessions,
            })
        };

        read().map_err(|_| ChatError::LoadFailed)
    }

    /// Saves a turn of `conversation`: a new id goes to the end, a known id is updated in place. The first message names the conversation.
    ///
    /// # Errors
    /// Fails on an unknown CLI or conversation, an empty or oversized field, or when the database cannot be written.
    pub fn save_turn(&mut self, workspace: &str, conversation: i64, turn: &ChatTurn) -> Result<()> {
        if Cli::parse(&turn.cli).is_none()
            || turn.id.is_empty()
            || turn.id.len() > MAX_ID_BYTES
            || turn.prompt.len() > MAX_PROMPT_BYTES
            || turn.answer.len() > MAX_ANSWER_BYTES
            || turn
                .steps
                .as_ref()
                .is_some_and(|steps| steps.len() > MAX_STEPS_BYTES)
            || workspace.is_empty()
            || !self.owns(workspace, conversation)
        {
            return Err(ChatError::Invalid);
        }

        let write = |connection: &mut Connection| -> rusqlite::Result<()> {
            let transaction = connection.transaction()?;
            let known: Option<i64> = transaction
                .query_row(
                    "SELECT position FROM chat_turns WHERE workspace = ?1 AND id = ?2",
                    params![workspace, turn.id],
                    |row| row.get(0),
                )
                .optional()?;
            let position = match known {
                Some(position) => position,
                None => transaction.query_row(
                    "SELECT COALESCE(MAX(position), 0) + 1 FROM chat_turns WHERE workspace = ?1",
                    [workspace],
                    |row| row.get(0),
                )?,
            };

            // An update keeps the row's place and its conversation.
            transaction.execute(
                "INSERT INTO chat_turns (workspace, id, position, cli, prompt, answer, error, conversation, steps)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT (workspace, id) DO UPDATE SET
                     cli = excluded.cli,
                     prompt = excluded.prompt,
                     answer = excluded.answer,
                     error = excluded.error,
                     steps = excluded.steps",
                params![
                    workspace,
                    turn.id,
                    position,
                    turn.cli,
                    turn.prompt,
                    turn.answer,
                    turn.error,
                    conversation,
                    turn.steps
                ],
            )?;
            transaction.execute(
                "UPDATE conversations SET updated_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE id = ?1",
                [conversation],
            )?;
            transaction.execute(
                "UPDATE conversations SET title = ?2 WHERE id = ?1 AND title = ''",
                params![conversation, title_of(&turn.prompt)],
            )?;
            transaction.execute(
                "DELETE FROM chat_turns WHERE workspace = ?1 AND position <= ?2 - ?3",
                params![workspace, position, MAX_TURNS],
            )?;

            transaction.commit()
        };

        write(&mut self.connection).map_err(|_| ChatError::SaveFailed)
    }

    /// Starts a new conversation in `workspace` and returns its id; the previous ones stay in the list. A conversation that has no turn yet is reused instead of piling up empty ones.
    ///
    /// # Errors
    /// Fails on an empty workspace key or when the database cannot be written.
    pub fn new_conversation(&mut self, workspace: &str) -> Result<i64> {
        if workspace.is_empty() {
            return Err(ChatError::Invalid);
        }

        let empty: Option<i64> = self
            .connection
            .query_row(
                "SELECT c.id FROM conversations c
                 WHERE c.workspace = ?1 AND NOT EXISTS (SELECT 1 FROM chat_turns t WHERE t.conversation = c.id)
                 ORDER BY c.id DESC LIMIT 1",
                [workspace],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ChatError::SaveFailed)?;

        if let Some(id) = empty {
            return Ok(id);
        }

        self.connection
            .execute(
                "INSERT INTO conversations (workspace, title, updated_at) VALUES (?1, '', CAST(strftime('%s', 'now') AS INTEGER))",
                [workspace],
            )
            .map_err(|_| ChatError::SaveFailed)?;

        Ok(self.connection.last_insert_rowid())
    }

    /// Deletes a conversation with its turns and session ids.
    ///
    /// # Errors
    /// Fails on a conversation of another workspace or when the database cannot be written.
    pub fn delete_conversation(&mut self, workspace: &str, conversation: i64) -> Result<()> {
        if !self.owns(workspace, conversation) {
            return Err(ChatError::Invalid);
        }

        let write = |connection: &mut Connection| -> rusqlite::Result<()> {
            let transaction = connection.transaction()?;

            transaction.execute(
                "DELETE FROM chat_turns WHERE conversation = ?1",
                [conversation],
            )?;
            transaction.execute(
                "DELETE FROM conversation_sessions WHERE conversation = ?1",
                [conversation],
            )?;
            transaction.execute("DELETE FROM conversations WHERE id = ?1", [conversation])?;

            transaction.commit()
        };

        write(&mut self.connection).map_err(|_| ChatError::SaveFailed)
    }

    /// Remembers the id `cli` gave for `conversation`.
    ///
    /// # Errors
    /// Fails on an unknown CLI or conversation, an empty or oversized id, or when the database cannot be written.
    pub fn save_session(
        &self,
        workspace: &str,
        conversation: i64,
        cli: &str,
        session: &str,
    ) -> Result<()> {
        if Cli::parse(cli).is_none()
            || session.is_empty()
            || session.len() > MAX_SESSION_BYTES
            || !self.owns(workspace, conversation)
        {
            return Err(ChatError::Invalid);
        }

        self.connection
            .execute(
                "INSERT OR REPLACE INTO conversation_sessions (conversation, cli, session) VALUES (?1, ?2, ?3)",
                params![conversation, cli, session],
            )
            .map(|_| ())
            .map_err(|_| ChatError::SaveFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, ChatStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ChatStore::open(dir.path().join("rynox.db"));

        (dir, store)
    }

    fn turn(id: &str, answer: &str) -> ChatTurn {
        ChatTurn {
            id: id.into(),
            cli: "claude".into(),
            prompt: format!("hỏi {id}"),
            answer: answer.into(),
            error: None,
            steps: None,
        }
    }

    #[test]
    fn turns_and_sessions_survive_a_reopen_and_stay_in_their_conversation() {
        let (dir, mut store) = store();
        let a = store.load("/a", None).unwrap().conversation;
        let b = store.load("/b", None).unwrap().conversation;

        store.save_turn("/a", a, &turn("t1", "một")).unwrap();
        store.save_turn("/a", a, &turn("t2", "hai")).unwrap();
        store.save_turn("/b", b, &turn("t1x", "khác")).unwrap();
        store.save_session("/a", a, "claude", "sess-1").unwrap();
        store.save_session("/a", a, "codex", "sess-2").unwrap();
        drop(store);

        let mut reopened = ChatStore::open(dir.path().join("rynox.db"));
        let history = reopened.load("/a", None).unwrap();

        assert_eq!(history.conversation, a);
        assert_eq!(
            history
                .turns
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            ["t1", "t2"]
        );
        assert_eq!(history.sessions["claude"], "sess-1");
        assert_eq!(history.sessions["codex"], "sess-2");
        assert_eq!(reopened.load("/b", None).unwrap().turns[0].answer, "khác");
    }

    #[test]
    fn saving_a_known_turn_updates_it_in_place() {
        let (_dir, mut store) = store();
        let c = store.load("/a", None).unwrap().conversation;

        store.save_turn("/a", c, &turn("t1", "nửa")).unwrap();
        store.save_turn("/a", c, &turn("t2", "hai")).unwrap();
        store.save_turn("/a", c, &turn("t1", "đủ câu")).unwrap();

        let turns = store.load("/a", Some(c)).unwrap().turns;

        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].answer, "đủ câu");
        assert_eq!(turns[1].id, "t2");
    }

    #[test]
    fn conversations_are_listed_with_a_title_from_the_first_message_and_kept_apart() {
        let (_dir, mut store) = store();
        let first = store.load("/a", None).unwrap().conversation;

        store.save_turn("/a", first, &turn("t1", "x")).unwrap();

        let second = store.new_conversation("/a").unwrap();

        assert_ne!(first, second);
        // An empty conversation is not listed, and asking for another one reuses it.
        assert_eq!(store.list("/a").unwrap().len(), 1);
        assert_eq!(store.new_conversation("/a").unwrap(), second);

        store.save_turn("/a", second, &turn("t2", "y")).unwrap();

        let list = store.list("/a").unwrap();

        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, second);
        assert_eq!(list[0].title, "hỏi t2");
        assert_eq!(store.load("/a", Some(first)).unwrap().turns.len(), 1);
        assert!(store.list("/other").unwrap().is_empty());
    }

    #[test]
    fn a_conversation_of_another_workspace_is_refused_and_delete_removes_everything() {
        let (_dir, mut store) = store();
        let c = store.load("/a", None).unwrap().conversation;

        store.save_turn("/a", c, &turn("t1", "x")).unwrap();
        store.save_session("/a", c, "claude", "s").unwrap();

        assert_eq!(store.load("/b", Some(c)), Err(ChatError::Invalid));
        assert_eq!(
            store.save_turn("/b", c, &turn("t9", "x")),
            Err(ChatError::Invalid)
        );
        assert_eq!(store.delete_conversation("/b", c), Err(ChatError::Invalid));

        store.delete_conversation("/a", c).unwrap();

        assert!(store.list("/a").unwrap().is_empty());
    }

    #[test]
    fn only_the_newest_turns_are_kept() {
        let (_dir, mut store) = store();
        let c = store.load("/a", None).unwrap().conversation;

        for number in 0..MAX_TURNS + 3 {
            store
                .save_turn("/a", c, &turn(&format!("t{number}"), "x"))
                .unwrap();
        }

        let turns = store.load("/a", Some(c)).unwrap().turns;

        assert_eq!(turns.len() as i64, MAX_TURNS);
        assert_eq!(turns[0].id, "t3");
    }

    #[test]
    fn turns_saved_before_conversations_are_grouped_on_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rynox.db");
        let old = Connection::open(&path).unwrap();

        old.execute_batch(
            "CREATE TABLE chat_turns (
                workspace TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
                cli TEXT NOT NULL, prompt TEXT NOT NULL, answer TEXT NOT NULL, error TEXT,
                archived INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace, id));
             CREATE TABLE chat_sessions (
                workspace TEXT NOT NULL, cli TEXT NOT NULL, session TEXT NOT NULL,
                PRIMARY KEY (workspace, cli));
             INSERT INTO chat_turns VALUES ('/a', 'o1', 1, 'claude', 'cũ', 'x', NULL, 1);
             INSERT INTO chat_turns VALUES ('/a', 'n1', 2, 'claude', 'hiện tại', 'y', NULL, 0);
             INSERT INTO chat_sessions VALUES ('/a', 'claude', 'sess');",
        )
        .unwrap();
        drop(old);

        let mut store = ChatStore::open(path);
        let list = store.list("/a").unwrap();

        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "hiện tại");
        assert_eq!(list[1].title, "Cuộc trò chuyện cũ");

        let current = store.load("/a", None).unwrap();

        assert_eq!(current.turns[0].id, "n1");
        assert_eq!(current.sessions["claude"], "sess");
    }

    #[test]
    fn titles_skip_attachments_and_are_cut() {
        assert_eq!(title_of("@/tmp/a.png\nxin chào"), "xin chào");
        assert_eq!(
            title_of(&"a".repeat(80)).chars().count(),
            MAX_TITLE_CHARS + 1
        );
        assert_eq!(title_of("@/tmp/a.png"), "");
    }

    #[test]
    fn bad_input_is_refused() {
        let (_dir, mut store) = store();
        let c = store.load("/a", None).unwrap().conversation;
        let mut unknown_cli = turn("t1", "x");

        unknown_cli.cli = "gemini".into();

        assert_eq!(
            store.save_turn("/a", c, &unknown_cli),
            Err(ChatError::Invalid)
        );
        assert_eq!(
            store.save_turn("/a", c, &turn("", "x")),
            Err(ChatError::Invalid)
        );
        assert_eq!(
            store.save_turn("", c, &turn("t1", "x")),
            Err(ChatError::Invalid)
        );
        assert_eq!(
            store.save_session("/a", c, "claude", ""),
            Err(ChatError::Invalid)
        );
        assert_eq!(
            store.save_session("/a", c, "gemini", "s"),
            Err(ChatError::Invalid)
        );
        assert!(store.load("/a", Some(c)).unwrap().turns.is_empty());
    }
}
