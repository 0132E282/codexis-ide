export const CHANGE_BADGES = {
    update: {
        letter: 'M',
        label: 'constants.modified',
        className: 'text-yellow-600 dark:text-yellow-400',
    },
    create: {
        letter: 'A',
        label: 'constants.new',
        className: 'text-green-600 dark:text-green-400',
    },
} as const;

// * How often an open local file is checked against the disk (the local file reads share a per-minute budget).
export const LIVE_REFRESH_MS = 8000;

/** Width of the sidebar and the width the chat gets back when it is opened again. */
export const SIDEBAR_WIDTH = 256;
// * The file tree can be dragged this wide at most.
export const TREE_MAX_WIDTH = 640;
export const CHAT_OPEN_WIDTH = 384;
// * The open file's column starts this wide (dragged wider or narrower); the chat takes the rest.
export const FILE_PANEL_DEFAULT_WIDTH = 600;
// * The change list column starts this wide; the chat takes the rest, and the column is dragged wider or narrower.
export const CHANGES_PANEL_DEFAULT_WIDTH = FILE_PANEL_DEFAULT_WIDTH;

/** Drag data type carrying the path (relative to the project) of a file or folder dragged out of the file tree. */
export const TREE_PATH_MIME = 'application/x-codexis-tree-path';
