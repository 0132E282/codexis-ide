import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FrameRect = { left: number; top: number; width: number; height: number };

type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 160;
const DRAG_THRESHOLD = 4;
const INTERACTIVE =
    'button:not([role="tab"]), input, textarea, select, a, [role="menu"]';

const HANDLES: { mode: DragMode; className: string }[] = [
    { mode: 'n', className: 'inset-x-2 top-0 h-1.5 cursor-ns-resize' },
    { mode: 's', className: 'inset-x-2 bottom-0 h-1.5 cursor-ns-resize' },
    { mode: 'w', className: 'inset-y-2 left-0 w-1.5 cursor-ew-resize' },
    { mode: 'e', className: 'inset-y-2 right-0 w-1.5 cursor-ew-resize' },
    { mode: 'nw', className: 'top-0 left-0 size-3 cursor-nwse-resize' },
    { mode: 'ne', className: 'top-0 right-0 size-3 cursor-nesw-resize' },
    { mode: 'sw', className: 'bottom-0 left-0 size-3 cursor-nesw-resize' },
    { mode: 'se', className: 'right-0 bottom-0 size-3 cursor-nwse-resize' },
];

function readRect(key: string): FrameRect | null {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');

        if (typeof stored !== 'object' || stored === null) {
            return null;
        }

        const { left, top, width, height } = stored as Record<string, unknown>;

        return [left, top, width, height].every(
            (value) => typeof value === 'number' && Number.isFinite(value),
        )
            ? (stored as FrameRect)
            : null;
    } catch {
        return null;
    }
}

function clampRect(
    rect: FrameRect,
    bounds: { width: number; height: number },
): FrameRect {
    const width = Math.min(Math.max(rect.width, MIN_WIDTH), bounds.width);
    const height = Math.min(Math.max(rect.height, MIN_HEIGHT), bounds.height);

    return {
        width,
        height,
        left: Math.min(Math.max(rect.left, 0), bounds.width - width),
        top: Math.min(Math.max(rect.top, 0), bounds.height - height),
    };
}

/**
 * A floating card the user drags by the `data-float-drag` area inside it (the tab bar; buttons other than tabs are not drag starts)
 * and resizes by its edges and corners. It stays inside its positioned parent, and the rect is kept in localStorage under `storageKey`.
 * Until the first drag the `className` (the default corner and size) rules; a drag that moved never clicks the tab it started on.
 */
export function FloatingFrame({
    storageKey,
    enabled,
    className,
    style,
    children,
}: {
    storageKey: string;
    /** Only a floating panel can be dragged; the same element serves the docked placements so its content is not remounted. */
    enabled: boolean;
    className?: string;
    /** Style used while not `enabled`. */
    style?: CSSProperties;
    children: ReactNode;
}) {
    const frame = useRef<HTMLDivElement>(null);
    const [rect, setRect] = useState<FrameRect | null>(() =>
        readRect(storageKey),
    );
    const suppressClick = useRef(false);

    const getBounds = () => {
        const parent = frame.current?.offsetParent;

        return {
            width: parent?.clientWidth ?? window.innerWidth,
            height: parent?.clientHeight ?? window.innerHeight,
        };
    };

    // * Keep a stored or dragged rect inside the window when the window shrinks.
    useEffect(() => {
        const fit = () =>
            setRect((current) =>
                current === null
                    ? current
                    : clampRect(current, {
                          width:
                              frame.current?.offsetParent?.clientWidth ??
                              window.innerWidth,
                          height:
                              frame.current?.offsetParent?.clientHeight ??
                              window.innerHeight,
                      }),
            );

        fit();
        window.addEventListener('resize', fit);

        return () => window.removeEventListener('resize', fit);
    }, []);

    const start = (mode: DragMode, event: PointerEvent) => {
        const element = frame.current;
        const parent = element?.offsetParent;

        if (event.button !== 0 || !element || !parent) {
            return;
        }

        const elementBox = element.getBoundingClientRect();
        const parentBox = parent.getBoundingClientRect();
        const origin: FrameRect = {
            left: elementBox.left - parentBox.left,
            top: elementBox.top - parentBox.top,
            width: elementBox.width,
            height: elementBox.height,
        };
        const startX = event.clientX;
        const startY = event.clientY;
        let moved = false;
        let latest: FrameRect = origin;

        const onMove = (move: globalThis.PointerEvent) => {
            const dx = move.clientX - startX;
            const dy = move.clientY - startY;

            if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
                return;
            }

            if (!moved) {
                moved = true;
                document.body.style.userSelect = 'none';
            }

            const next = { ...origin };

            if (mode === 'move') {
                next.left += dx;
                next.top += dy;
            } else {
                if (mode.includes('e')) {
                    next.width = origin.width + dx;
                }

                if (mode.includes('s')) {
                    next.height = origin.height + dy;
                }

                if (mode.includes('w')) {
                    next.width = Math.max(MIN_WIDTH, origin.width - dx);
                    next.left = origin.left + origin.width - next.width;
                }

                if (mode.includes('n')) {
                    next.height = Math.max(MIN_HEIGHT, origin.height - dy);
                    next.top = origin.top + origin.height - next.height;
                }
            }

            latest = clampRect(next, getBounds());
            setRect(latest);
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            document.body.style.userSelect = '';

            if (!moved) {
                return;
            }

            // * The click that follows this pointerup must not reach the tab the drag started on.
            suppressClick.current = true;
            setTimeout(() => {
                suppressClick.current = false;
            }, 0);

            try {
                localStorage.setItem(storageKey, JSON.stringify(latest));
            } catch {
                // * A display preference: not kept when storage is unavailable.
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;

        if (
            target.closest('[data-float-drag]') === null ||
            target.closest(INTERACTIVE) !== null
        ) {
            return;
        }

        start('move', event);
    };

    return (
        <div
            ref={frame}
            className={className}
            style={
                !enabled
                    ? style
                    : rect === null
                      ? undefined
                      : {
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                            height: rect.height,
                            right: 'auto',
                            bottom: 'auto',
                            maxHeight: 'none',
                        }
            }
            onPointerDown={enabled ? onPointerDown : undefined}
            onClickCapture={(event) => {
                if (suppressClick.current) {
                    event.stopPropagation();
                    event.preventDefault();
                }
            }}
        >
            {children}
            {enabled &&
                HANDLES.map(({ mode, className: handleClass }) => (
                    <div
                        key={mode}
                        aria-hidden="true"
                        data-float-handle={mode}
                        className={cn('absolute z-20 touch-none', handleClass)}
                        onPointerDown={(event) => {
                            event.stopPropagation();
                            start(mode, event);
                        }}
                    />
                ))}
        </div>
    );
}
