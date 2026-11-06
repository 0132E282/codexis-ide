import { useEffect, useRef } from 'react';

/** * Cmd/Ctrl+S anywhere in the page (not only inside the editor) while a file is open: runs `onSave`; the browser's own "save page" never opens. */
export function useSaveShortcut(selected: string | null, onSave: () => void) {
    const shortcut = useRef<() => void>(() => undefined);

    shortcut.current = onSave;

    useEffect(() => {
        if (selected === null) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 's'
            ) {
                event.preventDefault();
                shortcut.current();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [selected]);
}

/** * Cmd/Ctrl+P: calls `onTrigger` to find a file by name (while this viewer is on screen). */
export function useQuickOpenShortcut(onTrigger: () => void) {
    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                !event.shiftKey &&
                !event.altKey &&
                event.key.toLowerCase() === 'p'
            ) {
                event.preventDefault();
                onTrigger();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [onTrigger]);
}
