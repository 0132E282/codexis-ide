import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** * Every project keeps its viewer mounted (hidden with display:none when not shown), so a window-wide key must only reach the viewer whose marker sits in a displayed tree. */
export function isOnScreen(host: RefObject<HTMLElement | null>): boolean {
    const parent = host.current?.parentElement;

    return parent !== null && parent !== undefined
        ? parent.getClientRects().length > 0
        : false;
}

/** * Cmd/Ctrl+S anywhere in the page (not only inside the editor) while a file is open: runs `onSave`; the browser's own "save page" never opens. */
export function useSaveShortcut(
    host: RefObject<HTMLElement | null>,
    selected: string | null,
    onSave: () => void,
) {
    const shortcut = useRef<() => void>(() => undefined);

    shortcut.current = onSave;

    useEffect(() => {
        if (selected === null) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 's' &&
                isOnScreen(host)
            ) {
                event.preventDefault();
                shortcut.current();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [host, selected]);
}

/** * Quick-open shortcut: a viewer reacts only while on screen. */
export function useQuickOpenShortcut(
    host: RefObject<HTMLElement | null>,
    onTrigger: () => void,
) {
    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                !event.shiftKey &&
                !event.altKey &&
                event.key.toLowerCase() === 'p' &&
                isOnScreen(host)
            ) {
                event.preventDefault();
                onTrigger();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [host, onTrigger]);
}
