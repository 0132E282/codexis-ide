import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '@/lib/ide';
import { ideAuth, type AuthStatus } from '@/lib/ide-auth';

// * A login finishes in the browser, outside the app, so the state is re-read while a login screen is open.
const POLL_MILLISECONDS = 3000;

/** Sign-in state of the AI CLIs and GitHub: read once, and re-read every few seconds while `polling` or while no AI CLI is signed in. `statuses` is null until the first read. */
export function useAuthStatus(polling: boolean) {
    const [statuses, setStatuses] = useState<AuthStatus[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // * A read can outlast the polling interval: a new one starts only when the last has ended, so slow reads never pile up.
    const reading = useRef(false);

    const refresh = useCallback(() => {
        if (reading.current) {
            return Promise.resolve();
        }

        reading.current = true;

        return ideAuth
            .status()
            .then((next) => {
                setStatuses(next);
                setError(null);
            })
            .catch((caught) => setError(errorText(caught)))
            .finally(() => {
                reading.current = false;
            });
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const gated = statuses === null || !canChat(statuses);

    useEffect(() => {
        if (!polling && !gated) {
            return;
        }

        const timer = window.setInterval(
            () => void refresh(),
            POLL_MILLISECONDS,
        );

        return () => window.clearInterval(timer);
    }, [polling, gated, refresh]);

    return { statuses, error, refresh };
}

/** Chatting needs Claude or Codex signed in; Gemini (connect only) and GitHub are optional. */
export const canChat = (statuses: AuthStatus[]) =>
    statuses.some(
        (status) =>
            (status.provider === 'claude' || status.provider === 'codex') &&
            status.installed &&
            status.loggedIn,
    );
