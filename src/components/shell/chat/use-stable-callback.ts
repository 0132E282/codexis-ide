import { useCallback, useLayoutEffect, useRef } from 'react';

/** A function that never changes between renders yet always runs the latest `callback`: for props of memoised children and for listeners that are set up once. */
export function useStableCallback<Args extends unknown[], Result>(
    callback: (...args: Args) => Result,
): (...args: Args) => Result {
    const latest = useRef(callback);

    useLayoutEffect(() => {
        latest.current = callback;
    });

    return useCallback((...args: Args) => latest.current(...args), []);
}
