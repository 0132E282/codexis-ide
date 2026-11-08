import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { backgroundApi, type BackgroundTask } from '@/lib/api';
import { translateError } from '@/lib/i18n';
import { errorText } from '@/lib/ide';

/** The background tasks of one project, kept by the backend: loaded on open and again whenever the backend says the table changed. */
export function useBackgroundTasks(root: string | undefined) {
    const [tasks, setTasks] = useState<BackgroundTask[]>([]);
    const [failed, setFailed] = useState(false);

    const refresh = useCallback(async () => {
        if (root === undefined) {
            setTasks([]);

            return;
        }

        try {
            setTasks((await backgroundApi.list(root)).tasks);
            setFailed(false);
        } catch {
            // * The command may be missing or the project closed: the pane shows a short notice instead of stale rows.
            setFailed(true);
        }
    }, [root]);

    useEffect(() => {
        void refresh();

        const stop = backgroundApi.onChange(() => void refresh());

        return () => void stop.then((unlisten) => unlisten());
    }, [refresh]);

    const stopTask = useCallback(
        async (id: string) => {
            if (root === undefined) {
                return;
            }

            try {
                await backgroundApi.stop(root, id);
                await refresh();
            } catch (failure) {
                // * The task may be gone or the turn over (`background.stop_failed`): a toast, the table is left as it is.
                toast.error(translateError(errorText(failure)));
            }
        },
        [root, refresh],
    );

    const clearFinished = useCallback(async () => {
        if (root === undefined) {
            return;
        }

        try {
            await backgroundApi.clear(root);
            await refresh();
        } catch {
            setFailed(true);
        }
    }, [root, refresh]);

    return { tasks, failed, stopTask, clearFinished };
}
