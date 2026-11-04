// * Stale-while-revalidate copy of AI chat data. sessionStorage only (private text on a shared computer: gone when the tab closes), keyed by user id, size-capped, and cleared at logout.

const PREFIX = 'ai-chat.cache.';

/**
 * Whose data the in-memory caches hold. Every memory key is prefixed with it, so one person's data is never served to another; set by the chat page from the signed-in user.
 * Switching to another person drops the memory caches.
 */
const scope = 'anon';

const scoped = (key: string) => `${scope}|${key}`;

const requests = new Map<string, { at: number; promise: Promise<unknown> }>();

/**
 * Runs `fetcher` at most once per `ttlMs` for the same key and shares one in-flight request, so reopening the Code tab, a repo or the repo picker does not spend the server's per-minute budget.
 * Memory only (gone on reload, cleared at logout); a failed request is not kept, so the next call retries.
 */
export function cachedRequest<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
): Promise<T> {
    const memoryKey = scoped(key);
    const hit = requests.get(memoryKey);

    if (hit && Date.now() - hit.at < ttlMs) {
        return hit.promise as Promise<T>;
    }

    const promise = fetcher();

    requests.set(memoryKey, { at: Date.now(), promise });
    promise.catch(() => {
        if (requests.get(memoryKey)?.promise === promise) {
            requests.delete(memoryKey);
        }
    });

    return promise;
}

// * Stale-while-revalidate for data shown in dialogs and menus: the last value is shown at once, a background request refreshes it when older than its TTL.
// * Memory only on purpose (account names, local folder labels): nothing of it reaches sessionStorage.
const revalidated = new Map<
    string,
    { at: number; ttlMs: number; value: unknown }
>();
const inflight = new Map<string, Promise<unknown>>();

/** @returns the last value and whether it is still within its TTL, or null when there is none. */
export function peekAiChatRequest<T>(
    key: string,
): { value: T; fresh: boolean } | null {
    const hit = revalidated.get(scoped(key));

    return hit
        ? { value: hit.value as T, fresh: Date.now() - hit.at < hit.ttlMs }
        : null;
}

/** * Puts a known-good value in the cache (for example the answer of a write that returns the new state). */
export function storeAiChatRequest(
    key: string,
    ttlMs: number,
    value: unknown,
): void {
    revalidated.set(scoped(key), { at: Date.now(), ttlMs, value });
}

/** * Fetches and stores the value; callers asking for the same key meanwhile share one request. A failure keeps the previous value. */
export function refreshAiChatRequest<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
): Promise<T> {
    const memoryKey = scoped(key);
    const running = inflight.get(memoryKey);

    if (running) {
        return running as Promise<T>;
    }

    const promise = fetcher()
        .then((value) => {
            // * A write invalidated this key while the request ran: its answer may predate the write, so it is not stored.
            if (inflight.get(memoryKey) === promise) {
                storeAiChatRequest(key, ttlMs, value);
            }

            return value;
        })
        .finally(() => {
            if (inflight.get(memoryKey) === promise) {
                inflight.delete(memoryKey);
            }
        });

    inflight.set(memoryKey, promise);

    return promise;
}

/**
 * Drops every cached entry whose key starts with `prefix`, in memory and in sessionStorage, for the current person. Call it after a write that changes that data
 * (`usage`, `local.`, `tree.{repo}`, `file.{repo}.`).
 */
export function invalidateAiChatCache(prefix: string): void {
    const memoryPrefix = scoped(prefix);

    [requests, revalidated, inflight].forEach((map) =>
        [...map.keys()]
            .filter((key) => key.startsWith(memoryPrefix))
            .forEach((key) => map.delete(key)),
    );

    try {
        const storagePrefix = `${PREFIX}${scope}.${prefix}`;

        Object.keys(sessionStorage)
            .filter((key) => key.startsWith(storagePrefix))
            .forEach((key) => sessionStorage.removeItem(key));
    } catch {
        // * Storage blocked: only memory was cleared.
    }
}
