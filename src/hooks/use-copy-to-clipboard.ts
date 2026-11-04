import { useCallback, useEffect, useRef, useState } from 'react';

const COPIED_RESET_MS = 2000;

/** * Copies text with navigator.clipboard; `copied` stays true for ~2s after a successful copy. A blocked clipboard is ignored (nothing changes). */
export function useCopyToClipboard() {
    const [copied, setCopied] = useState(false);
    const resetTimer = useRef<number | undefined>(undefined);

    useEffect(() => () => window.clearTimeout(resetTimer.current), []);

    const copy = useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // * Insecure context or denied permission: keep the label as is.
            return;
        }

        setCopied(true);
        window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(
            () => setCopied(false),
            COPIED_RESET_MS,
        );
    }, []);

    return { copied, copy };
}
