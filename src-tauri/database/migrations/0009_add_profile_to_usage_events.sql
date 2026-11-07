-- Files made before accounts could be switched lack the column; their turns belong to the default account (0). Run only when it is missing.
ALTER TABLE usage_events ADD COLUMN profile INTEGER NOT NULL DEFAULT 0;
