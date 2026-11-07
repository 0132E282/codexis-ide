-- Files made before conversations were listed lack the column; run only when it is missing.
ALTER TABLE chat_turns ADD COLUMN conversation INTEGER NOT NULL DEFAULT 0;
