-- Files made before the steps of the AI were kept lack the column; run only when it is missing.
ALTER TABLE chat_turns ADD COLUMN steps TEXT;
