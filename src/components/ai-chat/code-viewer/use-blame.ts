import { useEffect, useMemo, useState } from 'react';
import { ide } from '@/lib/ide';
import type { GitBlameLine } from '@/lib/ide';

const STORAGE_KEY = 'codexis.blame';
const CACHE_LIMIT = 20;
const MAX_LINES = 5000;
// * A commit, checkout or pull can change the blame without changing the file text: an entry older than this is read again.
const CACHE_MAX_AGE_MS = 60_000;

// * Blame already read, by file and text: going back to a tab does not ask git again. The oldest entry goes first.
const cache = new Map<string, { lines: GitBlameLine[]; at: number }>();

function fromCache(key: string): GitBlameLine[] | undefined {
    const entry = cache.get(key);

    if (entry === undefined) {
        return undefined;
    }
    if (Date.now() - entry.at > CACHE_MAX_AGE_MS) {
        cache.delete(key);

        return undefined;
    }

    return entry.lines;
}

function readEnabled(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
        return true;
    }
}

function countLines(text: string): number {
    let count = 1;

    for (let index = text.indexOf('\n'); index !== -1;) {
        count += 1;
        index = text.indexOf('\n', index + 1);
    }

    return count;
}

function hashText(text: string): string {
    let hash = 5381;

    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
    }

    return `${text.length}:${hash}`;
}

function remember(key: string, lines: GitBlameLine[]) {
    cache.delete(key);
    cache.set(key, { lines, at: Date.now() });

    if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next();

        if (oldest.done !== true) {
            cache.delete(oldest.value);
        }
    }
}

/** * The git blame of the open local file and the on/off switch of the line annotation (remembered in localStorage). It is read only while the switch is on and the file is shown (`isActive`), once per file text, never while typing, and not for a file over 5000 lines. */
export function useBlame({
    root,
    path,
    content,
    isActive,
}: {
    root: string | null;
    path: string | null;
    /** * The saved text of the file: a new text (after a save or a change on disk) loads the blame again. */
    content: string | null;
    /** * The file is on screen in the code view (not behind a diff, a picture or rendered markdown). */
    isActive: boolean;
}): {
    lines: GitBlameLine[] | null;
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
} {
    const [enabled, setEnabledState] = useState(readEnabled);
    // * The lines come with the key of the text they were read for: after a new text the old lines are not shown.
    const [loaded, setLoaded] = useState<{
        key: string;
        lines: GitBlameLine[];
    } | null>(null);

    const setEnabled = (next: boolean) => {
        setEnabledState(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
        } catch {
            // * Storage is blocked: the switch still works until the page closes.
        }
    };

    // * The text is counted and hashed once per text (a save or a change on disk), not on every render or key.
    const textKey = useMemo(
        () =>
            content === null || countLines(content) > MAX_LINES
                ? null
                : hashText(content),
        [content],
    );
    const key =
        enabled &&
        isActive &&
        root !== null &&
        path !== null &&
        textKey !== null
            ? `${root}\0${path}\0${textKey}`
            : null;
    const cached = key === null ? undefined : fromCache(key);

    useEffect(() => {
        if (
            key === null ||
            fromCache(key) !== undefined ||
            root === null ||
            path === null
        ) {
            return;
        }

        let isStale = false;

        ide.gitBlame(path, root)
            .then((result) => {
                remember(key, result);

                if (!isStale) {
                    setLoaded({ key, lines: result });
                }
            })
            // * Not a git repo, an untracked, binary or too large file: no annotation, no error.
            .catch(() => undefined);

        return () => {
            isStale = true;
        };
    }, [key, root, path]);

    const lines =
        cached ?? (loaded !== null && loaded.key === key ? loaded.lines : null);

    return { lines, enabled, setEnabled };
}
