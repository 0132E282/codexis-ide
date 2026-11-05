import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

const KEYBOARD_STEP = 16;

function readWidth(key: string, fallback: number, min: number, max: number) {
    try {
        const stored = Number(localStorage.getItem(key));

        return Number.isFinite(stored) && stored > 0
            ? Math.min(max, Math.max(min, stored))
            : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Width of a side panel that the user drags by its left edge (pointer events, one update per frame)
 * or resizes with the arrow keys. The width is a display preference kept in localStorage.
 * With `axis` 'y' the same hook sizes a panel by its top edge (its "width" is then the height; dragging up makes it taller).
 * With `edge` 'trailing' the handle is on the right (or bottom) edge instead, so dragging right (or down) makes the panel larger.
 */
export function useResizableWidth(
    storageKey: string,
    initial: number,
    min: number,
    max: number,
    axis: 'x' | 'y' = 'x',
    edge: 'leading' | 'trailing' = 'leading',
) {
    const direction = edge === 'leading' ? 1 : -1;
    const [width, setWidth] = useState(() =>
        readWidth(storageKey, initial, min, max),
    );
    const drag = useRef<{ start: number; startWidth: number } | null>(null);
    const frame = useRef<number | undefined>(undefined);
    const latest = useRef(width);

    useEffect(() => {
        latest.current = width;
    }, [width]);

    useEffect(() => () => cancelAnimationFrame(frame.current ?? 0), []);

    const clamp = useCallback(
        (value: number) => Math.min(max, Math.max(min, value)),
        [min, max],
    );

    const save = useCallback(() => {
        try {
            localStorage.setItem(
                storageKey,
                String(Math.round(latest.current)),
            );
        } catch {
            // * Storage blocked: the width still applies for this visit.
        }
    }, [storageKey]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
            start: axis === 'x' ? event.clientX : event.clientY,
            startWidth: latest.current,
        };
        // * No text selection while dragging.
        document.body.style.userSelect = 'none';
    };

    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const current = drag.current;

        if (current === null) {
            return;
        }

        // * With the handle on the leading (left or top) edge dragging left (or up) makes the panel larger; on the trailing edge it is the other way round.
        const wanted =
            current.startWidth +
            direction *
                (current.start -
                    (axis === 'x' ? event.clientX : event.clientY));

        const next = clamp(wanted);

        cancelAnimationFrame(frame.current ?? 0);
        frame.current = requestAnimationFrame(() => setWidth(next));
    };

    const endDrag = () => {
        if (drag.current === null) {
            return;
        }

        drag.current = null;
        document.body.style.userSelect = '';
        save();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const towardStart = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const towardEnd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        const grow = edge === 'leading' ? towardStart : towardEnd;
        const shrink = edge === 'leading' ? towardEnd : towardStart;
        const delta =
            event.key === grow
                ? KEYBOARD_STEP
                : event.key === shrink
                  ? -KEYBOARD_STEP
                  : 0;

        if (delta === 0) {
            return;
        }

        event.preventDefault();
        const next = clamp(latest.current + delta);

        latest.current = next;
        setWidth(next);
        save();
    };

    // * Narrows the panel to `limit` when it is wider (not saved: it is a one-off, e.g. to make room for the chat).
    const shrinkTo = useCallback(
        (limit: number) => {
            const next = clamp(Math.min(latest.current, limit));

            latest.current = next;
            setWidth(next);
        },
        [clamp],
    );

    return {
        width,
        shrinkTo,
        handleProps: {
            role: 'separator' as const,
            'aria-orientation': (axis === 'x' ? 'vertical' : 'horizontal') as
                'vertical' | 'horizontal',
            'aria-valuenow': Math.round(width),
            'aria-valuemin': min,
            'aria-valuemax': max,
            tabIndex: 0,
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onKeyDown,
        },
    };
}
