import { useEffect } from 'react';
import { ide } from '@/lib/ide';

/** The three native window buttons stay hidden until the pointer reaches the top-left corner; the page is only watched, never covered, so the buttons under it stay clickable. */
export function useWindowButtonsHover() {
    useEffect(() => {
        let shown = false;

        const onMove = (event: MouseEvent) => {
            // * Shown by touching the very top edge, kept while the pointer stays over the buttons: the toggle icon under them can still be reached from below.
            const near =
                event.clientX < 96 && event.clientY < (shown ? 36 : 12);

            if (near !== shown) {
                shown = near;
                void ide.windowButtonsVisible(near).catch(() => undefined);
            }
        };

        window.addEventListener('mousemove', onMove);

        return () => window.removeEventListener('mousemove', onMove);
    }, []);
}
