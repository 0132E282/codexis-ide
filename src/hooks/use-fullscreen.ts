import { useEffect, useState } from 'react';
import { ide } from '@/lib/ide';

/** Whether the window is fullscreen, read on mount and again on every resize (entering or leaving fullscreen resizes the window). Stays false where there is no Tauri, such as a plain browser. */
export function useFullscreen() {
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        let isCurrent = true;

        const refresh = () => {
            ide.windowIsFullscreen().then(
                (value) => {
                    if (isCurrent) {
                        setIsFullscreen(value);
                    }
                },
                () => undefined,
            );
        };

        refresh();
        window.addEventListener('resize', refresh);

        return () => {
            isCurrent = false;
            window.removeEventListener('resize', refresh);
        };
    }, []);

    return isFullscreen;
}
