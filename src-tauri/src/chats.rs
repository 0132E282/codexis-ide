//! Chat history of the AI panel, kept in the SQLite file next to the saved projects (see `db`).
//!
//! History belongs to a workspace (its root path) and is split into conversations, as the Claude CLI splits its sessions: each conversation has a title taken from its first message, a last-used time, its turns and the session id of each CLI, so opening it again continues the same `claude` / `codex` conversation.

use crate::cli::CliKind;
use crate::{db, sql, validation};
use rusqlite::{params, Connection, OptionalExtension};
use sea_query::{Alias, Condition, Expr, ExprTrait, Query, Value};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

/// Oldest turns beyond this many per workspace are dropped.
pub const MAX_TURNS: i64 = 500;
const MAX_ANSWER_BYTES: usize = 2_000_000;

/// Sizes of the saved turns of one conversation (see `ChatStore::size_of`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConversationSize {
    pub turns: i64,
    pub failed_turns: i64,
    pub prompt_characters: i64,
    pub answer_characters: i64,
    /// CLI of the newest saved turn (None: no turn yet).
    pub last_cli: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatError {
    Invalid,
    /// Refused by `validation`; holds its `validation.*` key.
    Rejected(&'static str),
    SaveFailed,
    LoadFailed,
}

impl ChatError {
    /// Fixed user-facing text.
    pub fn message(self) -> &'static str {
        match self {
            Self::Invalid => "chats.invalid",
            Self::Rejected(key) => key,
            Self::SaveFailed => "chats.save_failed",
            Self::LoadFailed => "chats.load_failed",
        }
    }
}

impl fmt::Display for ChatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ChatError {}

impl From<validation::ValidationError> for ChatError {
    fn from(error: validation::ValidationError) -> Self {
        [
            validation::KEY_EMPTY,
            validation::KEY_TOO_LONG,
            validation::KEY_CONTROL_CHAR,
            validation::KEY_BAD_RUN_ID,
            validation::KEY_BAD_SESSION,
            validation::KEY_BAD_STEPS,
        ]
        .into_iter()
        .find(|key| *key == error.key())
        .map_or(Self::Invalid, Self::Rejected)
    }
}

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
    /// Context usage after the turn, as the JSON the UI got from the agent; stored as is.
    #[serde(default)]
    pub context: Option<String>,
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

/// One chat of the grid: a conversation and the workspace (project folder) it belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GridMember {
    /// The grid (group) this chat is in; a group has no fixed limit (the grid lays them out in rows of three).
    pub group: i64,
    pub workspace: String,
    pub conversation: i64,
    /// Title of the conversation, for the sidebar; only read: saving the grid ignores it.
    pub title: String,
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
        sql::query_first(
            &self.connection,
            Query::select()
                .expr(Expr::val(1_i64))
                .from(Alias::new("conversations"))
                .and_where(Expr::col(Alias::new("id")).eq(conversation))
                .and_where(Expr::col(Alias::new("workspace")).eq(workspace)),
            |_| Ok(()),
        )
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
        validation::workspace_key(workspace)?;

        let id = match conversation {
            Some(id) if self.owns(workspace, id) => id,
            Some(_) => return Err(ChatError::Invalid),
            None => match self.list(workspace)?.first() {
                Some(latest) => latest.id,
                None => self.new_conversation(workspace)?,
            },
        };
        let read = || -> rusqlite::Result<ChatHistory> {
            let turns = sql::list_ordered(
                &self.connection,
                "chat_turns",
                &["id", "cli", "prompt", "answer", "error", "steps", "context"],
                Condition::all().add(Expr::col(Alias::new("conversation")).eq(id)),
                "position",
                |row| {
                    Ok(ChatTurn {
                        id: row.get(0)?,
                        cli: row.get(1)?,
                        prompt: row.get(2)?,
                        answer: row.get(3)?,
                        error: row.get(4)?,
                        steps: row.get(5)?,
                        context: row.get(6)?,
                    })
                },
            )?;
            let sessions = sql::query_all(
                &self.connection,
                Query::select()
                    .columns([Alias::new("cli"), Alias::new("session")])
                    .from(Alias::new("conversation_sessions"))
                    .and_where(Expr::col(Alias::new("conversation")).eq(id)),
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?
            .into_iter()
            // * A session that is not valid (a row written before the checks) never goes back to a CLI.
            .filter(|(_, session)| validation::valid_session(session).is_ok())
            .collect::<HashMap<String, String>>();

            Ok(ChatHistory {
                conversation: id,
                turns,
                sessions,
            })
        };

        read().map_err(|_| ChatError::LoadFailed)
    }

    /// The saved steps (JSON) of every turn of `conversation`, oldest first; turns with no steps are left out.
    ///
    /// # Errors
    /// Fails on a conversation of another workspace or when the database cannot be read.
    pub fn steps_of(&self, workspace: &str, conversation: i64) -> Result<Vec<String>> {
        validation::workspace_key(workspace)?;

        if !self.owns(workspace, conversation) {
            return Err(ChatError::Invalid);
        }

        sql::list_ordered(
            &self.connection,
            "chat_turns",
            &["steps"],
            Condition::all().add(Expr::col(Alias::new("conversation")).eq(conversation)),
            "position",
            |row| row.get::<_, Option<String>>(0),
        )
        .map(|steps| steps.into_iter().flatten().collect())
        .map_err(|_| ChatError::LoadFailed)
    }

    /// Sizes of the saved turns of `conversation`: how many, how many ended in an error and the characters of what was asked and answered. Sizes only, never the text.
    ///
    /// # Errors
    /// Fails on a conversation of another workspace or when the database cannot be read.
    pub fn size_of(&self, workspace: &str, conversation: i64) -> Result<ConversationSize> {
        validation::workspace_key(workspace)?;

        if !self.owns(workspace, conversation) {
            return Err(ChatError::Invalid);
        }

        self.connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(error IS NOT NULL), 0),
                        COALESCE(SUM(LENGTH(prompt)), 0),
                        COALESCE(SUM(LENGTH(answer)), 0),
                        (SELECT cli FROM chat_turns WHERE conversation = ?1 ORDER BY position DESC LIMIT 1)
                 FROM chat_turns WHERE conversation = ?1",
                params![conversation],
                |row| {
                    Ok(ConversationSize {
                        turns: row.get(0)?,
                        failed_turns: row.get(1)?,
                        prompt_characters: row.get(2)?,
                        answer_characters: row.get(3)?,
                        last_cli: row.get(4)?,
                    })
                },
            )
            .map_err(|_| ChatError::LoadFailed)
    }

    /// Saves a turn of `conversation`: a new id goes to the end, a known id is updated in place. The first message names the conversation.
    ///
    /// # Errors
    /// Fails on an unknown CLI or conversation, an empty or oversized field, or when the database cannot be written.
    pub fn save_turn(&mut self, workspace: &str, conversation: i64, turn: &ChatTurn) -> Result<()> {
        validation::workspace_key(workspace)?;
        validation::run_id(&turn.id, "")?;
        validation::prompt(&turn.prompt)?;

        if let Some(error) = &turn.error {
            validation::turn_error(error)?;
        }

        if let Some(steps) = &turn.steps {
            validation::steps_json(steps)?;
        }

        if let Some(context) = &turn.context {
            validation::steps_json(context)?;
        }

        if CliKind::parse_agent(&turn.cli).is_none()
            || turn.answer.len() > MAX_ANSWER_BYTES
            || !self.owns(workspace, conversation)
        {
            return Err(ChatError::Invalid);
        }

        let write = |connection: &mut Connection| -> rusqlite::Result<()> {
            let transaction = connection.transaction()?;
            let known: Option<i64> = sql::query_first(
                &transaction,
                Query::select()
                    .column(Alias::new("position"))
                    .from(Alias::new("chat_turns"))
                    .and_where(Expr::col(Alias::new("workspace")).eq(workspace))
                    .and_where(Expr::col(Alias::new("id")).eq(turn.id.as_str())),
                |row| row.get(0),
            )?;
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
                "INSERT INTO chat_turns (workspace, id, position, cli, prompt, answer, error, conversation, steps, context)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT (workspace, id) DO UPDATE SET
                     cli = excluded.cli,
                     prompt = excluded.prompt,
                     answer = excluded.answer,
                     error = excluded.error,
                     steps = excluded.steps,
                     context = excluded.context",
                params![
                    workspace,
                    turn.id,
                    position,
                    turn.cli,
                    turn.prompt,
                    turn.answer,
                    turn.error,
                    conversation,
                    turn.steps,
                    turn.context
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
            sql::delete_where(
                &transaction,
                "chat_turns",
                Condition::all()
                    .add(Expr::col(Alias::new("workspace")).eq(workspace))
                    .add(Expr::col(Alias::new("position")).lte(position - MAX_TURNS)),
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
        validation::workspace_key(workspace)?;

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

    /// Chats picked for the chat grid, in grid order, with the workspace each belongs to.
    ///
    /// # Errors
    /// Fails when the database cannot be read.
    pub fn grid(&self) -> Result<Vec<GridMember>> {
        let read = || -> rusqlite::Result<Vec<GridMember>> {
            self.connection
                .prepare(
                    "SELECT g.grp, g.workspace, g.conversation, c.title
                     FROM chat_grid_members g JOIN conversations c ON c.id = g.conversation
                     ORDER BY g.grp, g.position",
                )?
                .query_map([], |row| {
                    Ok(GridMember {
                        group: row.get(0)?,
                        workspace: row.get(1)?,
                        conversation: row.get(2)?,
                        title: row.get(3)?,
                    })
                })?
                .collect()
        };

        read().map_err(|_| ChatError::LoadFailed)
    }

    /// Replaces the chat grids with `members` (in order; each carries its group). One member is kept too: it is a pick waiting for a second chat, and the interface shows the grid from two on.
    ///
    /// # Errors
    /// Fails on a repeated conversation, a conversation that is not in its workspace, or when the database cannot be written.
    pub fn save_grid(&mut self, members: &[GridMember]) -> Result<()> {
        let repeated = members.iter().enumerate().any(|(index, member)| {
            members[..index]
                .iter()
                .any(|seen| seen.conversation == member.conversation)
        });

        if repeated
            || !members
                .iter()
                .all(|member| self.owns(&member.workspace, member.conversation))
        {
            return Err(ChatError::Invalid);
        }

        let write = |connection: &mut Connection| -> rusqlite::Result<()> {
            let transaction = connection.transaction()?;

            transaction.execute("DELETE FROM chat_grid_members", [])?;

            for (index, member) in members.iter().enumerate() {
                // * The position only orders the chats of a group; the index of the whole list is unique within it.
                transaction.execute(
                    "INSERT INTO chat_grid_members (grp, position, workspace, conversation) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        member.group,
                        index as i64,
                        member.workspace,
                        member.conversation
                    ],
                )?;
            }

            transaction.commit()
        };

        write(&mut self.connection).map_err(|_| ChatError::SaveFailed)
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

            for (table, column) in [
                ("chat_turns", "conversation"),
                ("conversation_sessions", "conversation"),
                ("chat_grid_members", "conversation"),
                ("conversations", "id"),
            ] {
                sql::delete_where(
                    &transaction,
                    table,
                    Condition::all().add(Expr::col(Alias::new(column)).eq(conversation)),
                )?;
            }

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
        validation::valid_session(session)?;

        if CliKind::parse_agent(cli).is_none() || !self.owns(workspace, conversation) {
            return Err(ChatError::Invalid);
        }

        sql::upsert(
            &self.connection,
            "conversation_sessions",
            &["conversation", "cli"],
            vec![
                ("conversation", Value::from(conversation)),
                ("cli", Value::from(cli)),
                ("session", Value::from(session)),
            ],
        )
        .map(|_| ())
        .map_err(|_| ChatError::SaveFailed)
    }
}

#[cfg(test)]
#[path = "../tests/unit/chats.rs"]
mod tests;
