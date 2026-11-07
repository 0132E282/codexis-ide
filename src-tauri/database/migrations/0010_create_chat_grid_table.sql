-- The conversations shown side by side in the chat grids. There can be several grids (`grp`); each holds at most four conversations, in grid order (`position`). A grid spans projects, so each row names its workspace.
CREATE TABLE IF NOT EXISTS chat_grid_members (
    grp INTEGER NOT NULL,
    position INTEGER NOT NULL,
    workspace TEXT NOT NULL,
    conversation INTEGER NOT NULL,
    PRIMARY KEY (grp, position)
);
