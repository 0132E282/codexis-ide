-- The models each AI CLI offers to the signed-in account, read when the account connects (`/model` of the CLI lists the same ones); `position` keeps the CLI's own order.
CREATE TABLE IF NOT EXISTS cli_models (
    cli TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT NOT NULL,
    position INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (cli, value)
);
