import { invoke } from '@/lib/invoke';
import { listen } from '@tauri-apps/api/event';

/** A newer version published on GitHub. */
export type AvailableUpdate = {
    version: string;
    currentVersion: string;
    notes: string | null;
};
/** Download progress of an install; `percent` is null while the size is unknown. */
export type UpdateProgress = {
    downloaded: number;
    total: number | null;
    percent: number | null;
};

export const ideUpdate = {
    /** The newer version the last check found, if any. */
    pending: () => invoke<AvailableUpdate | null>('update_pending'),
    /** Downloads and installs it, then the app restarts (so it only resolves on failure). */
    install: () => invoke<void>('update_install'),
    onAvailable: (handler: (update: AvailableUpdate) => void) =>
        listen<AvailableUpdate>('update-available', (event) =>
            handler(event.payload),
        ),
    onProgress: (handler: (progress: UpdateProgress) => void) =>
        listen<UpdateProgress>('update-progress', (event) =>
            handler(event.payload),
        ),
};
