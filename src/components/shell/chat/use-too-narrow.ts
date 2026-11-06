import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';

/** The chat closes when the editor columns squeeze it narrower than this (px). */
const CHAT_TOO_NARROW = 220;
/** Time after it opens during which a narrow chat is not closed again. */
const REOPEN_GRACE_MS = 800;

/** Watches the width the chat really has: the editor columns can squeeze it, and below this width it cannot be read, so `onTooNarrow` is told. */
export function useTooNarrow(
    section: RefObject<HTMLElement | null>,
    watching: boolean,
    onTooNarrow: () => void,
) {
    const notify = useStableCallback(onTooNarrow);

    useEffect(() => {
        const element = section.current;

        if (element === null || !watching) {
            return;
        }

        // * Just opened again: the columns are still making room, so it is not judged yet.
        const openedAt = performance.now();
        const observer = new ResizeObserver(([entry]) => {
            if (
                entry.contentRect.width < CHAT_TOO_NARROW &&
                performance.now() - openedAt > REOPEN_GRACE_MS
            ) {
                notify();
            }
        });

        observer.observe(element);

        return () => observer.disconnect();
    }, [section, watching, notify]);
}
