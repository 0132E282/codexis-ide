import { useCallback, useEffect, useRef, useState } from 'react';
import {
    peekAiChatRequest,
    refreshAiChatRequest,
    storeAiChatRequest,
} from '@/lib/ai-chat-cache';

const sameData = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);

/**
 * Stale-while-revalidate for a dialog or menu: shows the cached value at once, asks the server only when it is older than `ttlMs` (one shared request for the same key)
 * and replaces the shown data only when the answer differs, so an unchanged refresh does not re-render.
 * `mutate` shows and caches a value that is already known (the answer of a write).
 */
export function useCachedRequest<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
    enabled: boolean,
) {
    const [data, setData] = useState<T | null>(() =>
        enabled ? (peekAiChatRequest<T>(key)?.value ?? null) : null,
    );
    const [failed, setFailed] = useState(false);
    const fetcherRef = useRef(fetcher);

    fetcherRef.current = fetcher;

    useEffect(() => {
        if (!enabled) {
            return;
        }

        let cancelled = false;
        const hit = peekAiChatRequest<T>(key);

        setFailed(false);
        setData((current) =>
            hit === null
                ? null
                : sameData(current, hit.value)
                  ? current
                  : hit.value,
        );

        if (hit?.fresh) {
            return;
        }

        refreshAiChatRequest(key, ttlMs, () => fetcherRef.current())
            .then((value) => {
                if (!cancelled) {
                    setData((current) =>
                        sameData(current, value) ? current : value,
                    );
                }
            })
            .catch(() => {
                // * With a value already shown the failure stays silent; without one the caller shows its error.
                if (!cancelled && hit === null) {
                    setFailed(true);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [enabled, key, ttlMs]);

    const mutate = useCallback(
        (value: T) => {
            storeAiChatRequest(key, ttlMs, value);
            setData(value);
        },
        [key, ttlMs],
    );

    return { data, failed, mutate };
}
