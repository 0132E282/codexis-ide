-- Files made before the context usage of a turn was kept lack the column; run only when it is missing. Holds the JSON of the usage the UI showed after that turn.
ALTER TABLE chat_turns ADD COLUMN context TEXT;
