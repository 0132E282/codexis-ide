import { invoke } from '@/lib/invoke';

/** What changed a file: the person in the editor or file tree, or the AI. */
export type FileEventAction =
    | 'create'
    | 'save'
    | 'delete'
    | 'rename'
    | 'copy'
    | 'move'
    | 'discard'
    | 'ai_edit';
export type FileEventSource = 'user' | 'ai';

/** One stored file edit. Only the path and sizes are kept, never the code or the diff. */
export type FileEvent = {
    id: number;
    projectRoot: string;
    path: string;
    action: FileEventAction;
    source: FileEventSource;
    bytesAfter: number | null;
    /** Null for an edit of the AI (its content is never looked at). */
    linesAdded: number | null;
    linesRemoved: number | null;
    /** The path before a rename, copy or move. */
    oldPath: string | null;
    /** Unix seconds. */
    createdAt: number;
};

export type FileEventFilters = {
    /** Matches anywhere in the path. */
    path?: string;
    action?: FileEventAction;
    source?: FileEventSource;
    /** Unix seconds, both ends included. */
    from?: number;
    to?: number;
};

export type Page<T> = { items: T[]; total: number };

/** A picture of the chat kept in the database. */
export type ChatImage = {
    id: number;
    conversationId: number | null;
    name: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
    createdAt: number;
    /** Base64 of the picture itself when it is small (32 KB at most); null for a bigger one: use `chatImageGet`. */
    thumbnailBase64: string | null;
};

export type ChatImageData = { mime: string; dataBase64: string };

/** Index row of a plan file (the file in the project is the source of truth). */
export type PlanRecord = {
    id: number;
    projectRoot: string;
    path: string;
    title: string;
    status: string;
    tasksTotal: number;
    tasksDone: number;
    format: 'md' | 'json';
    createdAt: number;
    updatedAt: number;
};

export type PlanRecordsSync = {
    upserted: number;
    removed: number;
    skipped: number;
    truncated: boolean;
};

export type SavedPlan = {
    /** Relative to the project root. */
    path: string;
    format: 'md' | 'json';
    title: string;
    recordId: number | null;
};

export type StorageKind =
    | 'file_events'
    | 'chat_images'
    | 'plan_records'
    | 'run_logs'
    | 'chat_history'
    | 'session_plans';
/** Kinds `storageCleanup` can remove (chat history is deleted from the chat). */
export type StorageCleanupKind = Exclude<StorageKind, 'chat_history'>;

export type StorageItem = { kind: StorageKind; count: number; bytes: number };
export type StorageWarning = {
    kind: StorageKind | 'db';
    level: 'notice' | 'warning' | 'critical';
    count: number;
    bytes: number;
    thresholdBytes: number | null;
    thresholdCount: number | null;
};
export type StorageScope = {
    totalBytes: number;
    items: StorageItem[];
    warnings: StorageWarning[];
};
/** `items` and `warnings` are about the project; `app` is the same for every project together (its warnings include the database file `db`). */
export type StorageUsage = {
    totalBytes: number;
    dbBytes: number;
    items: StorageItem[];
    warnings: StorageWarning[];
    app: StorageScope;
};
export type StorageCleaned = { deleted: number; bytes: number };

/** Tauri events of the activity commands. */
export const ACTIVITY_EVENTS = {
    /** `{path, action, error}`: an edit was done but its event could not be stored. */
    fileEventLogFailed: 'file-event-log-failed',
    /** `{root, path}`: a plan was saved to the project on its own. */
    planSavedToProject: 'plan-saved-to-project',
    /** `{error}`: saving a plan to the project on its own failed. */
    planSaveFailed: 'plan-save-failed',
    /** `{error}`: a pasted picture could not be kept in the database. */
    chatImageStoreFailed: 'chat-image-store-failed',
} as const;

/** `root` is the project folder; absent = the open project. Deleting here only removes database rows, never a file of the project. */
export const ideActivity = {
    fileEventsList: (
        filters: FileEventFilters = {},
        limit = 100,
        offset = 0,
        root?: string,
    ) =>
        invoke<Page<FileEvent>>('file_events_list', {
            root,
            filters,
            limit,
            offset,
        }),
    /** Resolves to the number of rows deleted. */
    fileEventsDelete: (ids: number[]) =>
        invoke<number>('file_events_delete', { ids }),
    /** Deletes the events of a project (only those before `before`, Unix seconds, when given). */
    fileEventsClear: (before?: number, root?: string) =>
        invoke<number>('file_events_clear', { root, before }),
    chatImagesList: (limit = 100, offset = 0, root?: string) =>
        invoke<Page<ChatImage>>('chat_images_list', { root, limit, offset }),
    chatImageGet: (id: number) =>
        invoke<ChatImageData>('chat_image_get', { id }),
    chatImagesDelete: (ids: number[]) =>
        invoke<number>('chat_images_delete', { ids }),
    planRecordsList: (root?: string) =>
        invoke<PlanRecord[]>('plan_records_list', { root }),
    planRecordsDelete: (ids: number[]) =>
        invoke<number>('plan_records_delete', { ids }),
    /** Reads `docs/plans/` and makes the index match it. */
    planRecordsSync: (root?: string) =>
        invoke<PlanRecordsSync>('plan_records_sync', { root }),
    /** Saves the plan of a CLI session as a file of the project (folder: setting `plansDir`), even when `savePlansToProject` is off. A file that exists is never overwritten. */
    planSaveToProject: (session: string, root?: string) =>
        invoke<SavedPlan>('plan_save_to_project', { root, session }),
    /** Size of the data of the IDE with warnings. Read only. */
    storageUsage: (root?: string) =>
        invoke<StorageUsage>('storage_usage', { root }),
    /** Removes the app's own data of one kind; refused unless `confirm` is true. */
    storageCleanup: (
        kind: StorageCleanupKind,
        options: { olderThanDays?: number; root?: string; confirm: true },
    ) =>
        invoke<StorageCleaned>('storage_cleanup', {
            kind,
            olderThanDays: options.olderThanDays,
            root: options.root,
            confirm: options.confirm,
        }),
};
