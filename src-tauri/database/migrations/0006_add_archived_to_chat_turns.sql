-- Files made before conversations could be archived lack the column; run only when it is missing.
ALTER TABLE chat_turns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
