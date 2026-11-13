import { useState, useSyncExternalStore } from 'react';
import { t } from '@/lib/i18n';
import type { CursorStore } from '@/components/code-viewer/types/editor';

export type CursorStatus = {
    line: number;
    column: number;
    selectedChars: number;
    selectedLines: number;
};

function createCursorStore(): CursorStore {
    let current: CursorStatus | null = null;
    const listeners = new Set<() => void>();

    return {
        get: () => current,
        set: (status) => {
            if (
                status?.line === current?.line &&
                status?.column === current?.column &&
                status?.selectedChars === current?.selectedChars &&
                status?.selectedLines === current?.selectedLines
            ) {
                return;
            }

            current = status;
            listeners.forEach((listener) => listener());
        },
        subscribe: (listener) => {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
    };
}

export function useCursorStore(): CursorStore {
    return useState(createCursorStore)[0];
}

/** * `line:column` of the caret (1-based) and the size of the selection; a narrow bar hides the selection first, then the whole label. Display only. */
export function CursorPosition({ store }: { store: CursorStore }) {
    const status = useSyncExternalStore(store.subscribe, store.get);

    if (status === null) {
        return null;
    }

    const selection =
        status.selectedChars === 0
            ? null
            : status.selectedLines > 1
              ? t('cursor_position.selected_lines', {
                    count: status.selectedLines,
                })
              : t('cursor_position.selected_chars', {
                    count: status.selectedChars,
                });

    return (
        <span
            className="hidden shrink-0 whitespace-nowrap px-1 text-xs text-muted-foreground tabular-nums @md:inline"
            title={t('cursor_position.title')}
        >
            {status.line}:{status.column}
            {selection !== null && (
                <span className="hidden @xl:inline"> {selection}</span>
            )}
        </span>
    );
}
