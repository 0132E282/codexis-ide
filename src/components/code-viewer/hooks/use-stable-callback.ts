import { useCallback, useLayoutEffect, useRef } from 'react';

/** * A function whose identity never changes but that always runs the latest `callback`: lets memoized children keep their props while the handler reads fresh state. */
export function useStableCallback<Args extends unknown[], Result>(
    callback: (...args: Args) => Result,
): (...args: Args) => Result {
    const latest = useRef(callback);

    useLayoutEffect(() => {
        latest.current = callback;
    });

    return useCallback((...args: Args) => latest.current(...args), []);
}
