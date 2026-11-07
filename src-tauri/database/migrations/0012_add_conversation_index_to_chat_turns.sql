-- Turns are looked up by conversation (listing, last CLI, empty-conversation check); the primary key (workspace, id) cannot serve those. Needs the `conversation` column of 0007.
CREATE INDEX IF NOT EXISTS chat_turns_conversation_position ON chat_turns (conversation, position);
