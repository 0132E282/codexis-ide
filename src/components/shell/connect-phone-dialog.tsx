import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { errorText, ide, onRemoteConnected, type RemoteInfo } from '@/lib/ide';
import { t } from '@/lib/i18n';

/** Pairs the phone app: shows a QR code that holds the address and one-time token of the local server. */
export function ConnectPhoneDialog({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [info, setInfo] = useState<RemoteInfo | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [phones, setPhones] = useState(0);

    // * The server runs only while the dialog is open: closing it stops the server and drops every phone.
    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        let unlisten: (() => void) | undefined;

        setFailure(null);
        setPhones(0);
        void onRemoteConnected((count) => setPhones(count)).then((stop) => {
            if (cancelled) {
                stop();
            } else {
                unlisten = stop;
            }
        });
        ide.remoteStart()
            .then((next) => !cancelled && setInfo(next))
            .catch((caught) => !cancelled && setFailure(errorText(caught)));

        return () => {
            cancelled = true;
            unlisten?.();
            setInfo(null);
            void ide.remoteStop().catch(() => undefined);
        };
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('common.connect_phone')}</DialogTitle>
                    <DialogDescription>
                        {t('connect_phone_dialog.open_the_app_on')}
                    </DialogDescription>
                </DialogHeader>
                {failure !== null ? (
                    <p role="alert" className="text-sm text-destructive">
                        {failure}
                    </p>
                ) : info === null ? (
                    <p className="text-sm text-muted-foreground">
                        {t('connect_phone_dialog.opening_connection')}
                    </p>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <div className="rounded-lg bg-white p-3">
                            <QRCodeSVG
                                value={JSON.stringify({ v: 1, ...info })}
                                size={208}
                                title={t(
                                    'connect_phone_dialog.qr_code_to_connect',
                                )}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground tabular-nums">
                            {info.host}:{info.port}
                        </p>
                        <p role="status" className="text-sm">
                            {phones > 0
                                ? t(
                                      'connect_phone_dialog.count_phone_sconnected',
                                      {
                                          count: phones,
                                      },
                                  )
                                : t(
                                      'connect_phone_dialog.no_phone_connected_yet',
                                  )}
                        </p>
                    </div>
                )}
                <p className="text-xs text-muted-foreground">
                    {t('connect_phone_dialog.anyone_who_scans_this')}
                </p>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t('common.disconnect')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
