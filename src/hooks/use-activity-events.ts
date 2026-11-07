import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { ACTIVITY_EVENTS } from '@/lib/ide-activity';

/** Shows a toast for the events of the activity commands (a log write or a plan save that failed, a plan saved to the project). Does nothing outside the app. */
export function useActivityEvents() {
    useEffect(() => {
        const stops: Promise<() => void>[] = [];

        try {
            stops.push(
                listen<{ path: string }>(
                    ACTIVITY_EVENTS.fileEventLogFailed,
                    ({ payload }) =>
                        toast.warning(
                            t('activity.file_event_log_failed', {
                                path: payload.path,
                            }),
                        ),
                ),
                listen<{ path: string }>(
                    ACTIVITY_EVENTS.planSavedToProject,
                    ({ payload }) =>
                        toast.success(
                            t('activity.plan_saved', { path: payload.path }),
                        ),
                ),
                listen<{ error: string }>(
                    ACTIVITY_EVENTS.planSaveFailed,
                    ({ payload }) =>
                        toast.error(
                            t('activity.plan_save_failed', {
                                error: t(payload.error),
                            }),
                        ),
                ),
                listen<{ error: string }>(
                    ACTIVITY_EVENTS.chatImageStoreFailed,
                    () => toast.warning(t('activity.chat_image_store_failed')),
                ),
            );
        } catch {
            // * Not inside the app (a plain browser): there are no events.
        }

        return () => {
            stops.forEach((stop) =>
                stop.then((unlisten) => unlisten()).catch(() => undefined),
            );
        };
    }, []);
}
