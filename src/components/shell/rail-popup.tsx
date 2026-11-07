import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';

const HEADER_HEIGHT = 49;
const POPUP_GAP = 8;

/** The session rail as a popup over the main chat. Placed inside the (relative) message box form: it rests 8px above the top of the message box, its right edge on the box's, so the box stays visible. Escape or a click outside closes it. */
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
                style={{ height: height ?? undefined, right: -edgeGap }}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        onClose();
                    }
                }}
                className="absolute bottom-full z-40 mb-2 flex w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-l-xl border border-r-0 bg-background shadow-xl outline-none"
            >
                {children}
            </div>
        </>
    );
}
