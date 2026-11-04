import { useEffect, useRef, useState } from 'react';

// * Frames a backlog is spread over: the longer the text still to show, the more characters each frame reveals, so the typing never falls far behind the CLI.
const CATCH_UP_FRAMES = 40;

/** Reveals `text` a few characters at a time, like typing. Text that grows keeps typing from where it was; reduced motion shows everything at once. */
export function useTypewriter(text: string, enabled = true): string {
    const [shown, setShown] = useState(0);
    const target = useRef(text.length);

    useEffect(() => {
        target.current = text.length;
    }, [text]);

    const reduced =
        !enabled ||
        (typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    useEffect(() => {
        if (reduced) {
            return;
        }

        let frame = 0;
        const step = () => {
            setShown((current) => {
                const remaining = target.current - current;

                return remaining <= 0
                    ? current
                    : current +
                          Math.max(1, Math.ceil(remaining / CATCH_UP_FRAMES));
            });
            frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);

        return () => cancelAnimationFrame(frame);
    }, [reduced]);

    return reduced ? text : text.slice(0, shown);
}
