import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { t } from '@/lib/i18n';

const HEADER_HEIGHT = 49;
const POPUP_GAP = 8;
const DRAG_IGNORED = 'button, a, input, [role=menuitem]';

/** The session rail as a popup over the main chat. Placed inside the (relative) message box form: it rests 8px above the top of the message box, its right edge on the box's, so the box stays visible. Escape or a click outside closes it. It can be dragged by its `[data-rail-drag]` area (the title row, not its buttons) with mouse or touch, and never leaves the window; a double click on that area puts it back. The offset lives only while the popup is open. */
export function RailPopup({
    children,
    onClose,
}: {
    children: ReactNode;
    onClose: () => void;
}) {
    const popup = useRef<HTMLDivElement>(null);
    // * Height of the popup: it fills the space from the bottom of the chat header to just above the message box, and scrolls inside when its content is longer.
    const [height, setHeight] = useState<number | null>(null);

    // * Gap between the message box and the right edge of the chat column: the popup is pulled across it so it sits against that edge.
    const [edgeGap, setEdgeGap] = useState(0);

    // * Drag offset from the resting place, in px.
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const drag = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        origin: { x: number; y: number };
        rect: DOMRect;
    } | null>(null);

    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const target = event.target;

        if (
            !(target instanceof Element) ||
            (event.pointerType === 'mouse' && event.button !== 0) ||
            target.closest('[data-rail-drag]') === null ||
            target.closest(DRAG_IGNORED) !== null
        ) {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origin: offset,
            rect: event.currentTarget.getBoundingClientRect(),
        };
        setIsDragging(true);
    };

    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = drag.current;

        if (current === null || current.pointerId !== event.pointerId) {
            return;
        }

        // * Clamp the move so the whole popup stays inside the window.
        const { rect } = current;
        const moveX = Math.min(
            Math.max(event.clientX - current.startX, -rect.left),
            window.innerWidth - rect.right,
        );
        const moveY = Math.min(
            Math.max(event.clientY - current.startY, -rect.top),
            window.innerHeight - rect.bottom,
        );
        setOffset({ x: current.origin.x + moveX, y: current.origin.y + moveY });
    };

    const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId !== event.pointerId) {
            return;
        }

        drag.current = null;
        setIsDragging(false);
    };

    useLayoutEffect(() => {
        const measure = () => {
            const anchor = popup.current?.offsetParent;
            const top = anchor?.getBoundingClientRect().top ?? 0;
            const section = anchor?.closest('section')?.getBoundingClientRect();
            const area = section?.top ?? 0;
            setEdgeGap(
                Math.max(
                    0,
                    (section?.right ?? 0) -
                        (anchor?.getBoundingClientRect().right ?? 0),
                ),
            );
            setHeight(Math.max(160, top - area - HEADER_HEIGHT - POPUP_GAP));
        };

        measure();
        window.addEventListener('resize', measure);

        return () => window.removeEventListener('resize', measure);
    }, []);

    // * When the window shrinks, pull a popup that now sticks out back inside by adjusting the current offset.
    useEffect(() => {
        const keepInside = () => {
            const rect = popup.current?.getBoundingClientRect();

            if (rect === undefined) {
                return;
            }

            const shiftX =
                Math.max(0, -rect.left) -
                Math.max(0, rect.right - window.innerWidth);
            const shiftY =
                Math.max(0, -rect.top) -
                Math.max(0, rect.bottom - window.innerHeight);

            if (shiftX !== 0 || shiftY !== 0) {
                setOffset((previous) => ({
                    x: previous.x + shiftX,
                    y: previous.y + shiftY,
                }));
            }
        };

        window.addEventListener('resize', keepInside);

        return () => window.removeEventListener('resize', keepInside);
    }, []);

    // * A press outside closes the popup, except on the toggle buttons (they close it themselves) and on what the popup opened (a branch list in a portal).
    useEffect(() => {
        const closeOutside = (event: PointerEvent) => {
            const target = event.target;

            if (
                !(target instanceof Element) ||
                popup.current?.contains(target) ||
                target.closest(
                    '[data-rail-toggle], [data-radix-popper-content-wrapper], [role="dialog"], [role="menu"]',
                ) !== null
            ) {
                return;
            }

            onClose();
        };

        document.addEventListener('pointerdown', closeOutside);

        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [onClose]);

    // * Focus goes into the popup when it opens and back to what had it (the toggle button) when it closes.
    useEffect(() => {
        const previous = document.activeElement;
        popup.current?.focus();

        return () => {
            if (previous instanceof HTMLElement && previous.isConnected) {
                previous.focus();
            }
        };
    }, []);

    return (
        <>
            <div
                ref={popup}
                role="dialog"
                aria-label={t('session_rail.title')}
                tabIndex={-1}
                style={{
                    height: height ?? undefined,
                    right: -edgeGap,
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                }}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={(event) => {
                    // * The pointer is captured by the popup, so the event's target is the popup itself: the element under the pointer says what was hit.
                    const target = document.elementFromPoint(
                        event.clientX,
                        event.clientY,
                    );

                    if (
                        target !== null &&
                        target.closest('[data-rail-drag]') !== null &&
                        target.closest(DRAG_IGNORED) === null
                    ) {
                        setOffset({ x: 0, y: 0 });
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        onClose();
                    }
                }}
                className={`absolute bottom-full z-40 mb-2 flex w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-l-xl border border-r-0 bg-background shadow-xl outline-none [&_[data-rail-drag]]:touch-none ${isDragging ? 'cursor-grabbing select-none [&_[data-rail-drag]]:cursor-grabbing' : '[&_[data-rail-drag]]:cursor-grab'}`}
            >
                {children}
            </div>
        </>
    );
}
