import { useEffect } from 'react';

/** Files dragged in from outside the app are refused: left alone, the webview would navigate to the dropped file. Drags inside the app (tabs, lists) carry no files and are not touched. */
export function useFileDropGuard() {
    useEffect(() => {
        const refuse = (event: DragEvent) => {
            if (event.dataTransfer?.types.includes('Files')) {
                event.preventDefault();

                if (event.dataTransfer !== null) {
                    event.dataTransfer.dropEffect = 'none';
                }
            }
        };

        window.addEventListener('dragover', refuse);
        window.addEventListener('drop', refuse);

        return () => {
            window.removeEventListener('dragover', refuse);
            window.removeEventListener('drop', refuse);
        };
    }, []);
}
