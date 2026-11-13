import { useEffect, useRef, useState } from 'react';

// * Frames a backlog is spread over: the longer the text still to show, the more characters each frame reveals, so the typing never falls far behind the CLI.
const CATCH_UP_FRAMES = 40;

/** Reveals `text` a few characters at a time, like typing. Text that grows keeps typing from where it was; reduced motion shows everything at once. */
export function useTypewriter(text: string, enabled = true): string {
    const [shown, setShown] = useState(0);
    const shownRef = useRef(0);
    const length = text.length;

    const reduced =
        !enabled ||
        (typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    useEffect(() => {
        if (reduced) {
            return;
        }

        let frame = 0;
        // * The loop ends once the text is all shown and starts again when it grows: a finished turn costs no frame callback.
        const step = () => {
            const remaining = length - shownRef.current;

            if (remaining <= 0) {
                return;
            }

            shownRef.current += Math.max(
                1,
                Math.ceil(remaining / CATCH_UP_FRAMES),
            );
            setShown(shownRef.current);
            frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);

        return () => cancelAnimationFrame(frame);
    }, [reduced, length]);

    return reduced ? text : text.slice(0, shown);
}
