import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/ide';
import { ideUpdate } from '@/lib/ide-update';
import type { AvailableUpdate } from '@/lib/ide-update';
import { t } from '@/lib/i18n';

/** Whether the page runs inside the desktop app (not in a plain browser, where there is no backend to ask). */
const hasBackend = () => '__TAURI_INTERNALS__' in window;

/** A small notice in the corner when a newer version is published: "Update" installs it and restarts the app. */
export function UpdateBanner() {
    const [update, setUpdate] = useState<AvailableUpdate | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [percent, setPercent] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!hasBackend()) {
            return;
        }

        let active = true;
        const unlisten: Array<() => void> = [];
        const keep = (stop: () => void) =>
            active ? unlisten.push(stop) : stop();

        void ideUpdate
            .pending()
            .then((found) => active && found !== null && setUpdate(found))
            .catch(() => undefined);
        void ideUpdate
            .onAvailable((found) => {
                setUpdate(found);
                setDismissed(false);
            })
            .then(keep);
        void ideUpdate
            .onProgress((progress) => setPercent(progress.percent))
            .then(keep);

        return () => {
            active = false;
            unlisten.forEach((stop) => stop());
        };
    }, []);

    if (update === null || dismissed) {
        return null;
    }

    const install = () => {
        setInstalling(true);
        setError(null);
        setPercent(null);
        // * On success the app restarts, so the promise only ever settles with a failure.
        ideUpdate.install().catch((caught) => {
            setInstalling(false);
            setError(errorText(caught));
        });
    };

    return (
        <div
            role="status"
            className="fixed right-4 bottom-4 z-50 flex w-72 flex-col gap-2 rounded-md border bg-card p-3 text-sm shadow-lg"
        >
            <div className="flex items-start gap-2">
                <Download
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <p className="min-w-0 flex-1">
                    {t('app_update.available', { version: update.version })}
                </p>
                {!installing && (
                    <button
                        type="button"
                        aria-label={t('app_update.dismiss')}
                        title={t('app_update.dismiss')}
                        onClick={() => setDismissed(true)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                        <X aria-hidden="true" className="size-3.5" />
                    </button>
                )}
            </div>
            {error !== null && (
                <p className="text-xs text-destructive">{error}</p>
            )}
            {installing ? (
                <p className="text-xs text-muted-foreground">
                    {percent === null
                        ? t('app_update.installing')
                        : t('app_update.installing_percent', { percent })}
                </p>
            ) : (
                <Button size="sm" onClick={install}>
                    {t('app_update.update')}
                </Button>
            )}
        </div>
    );
}
