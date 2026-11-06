import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/lib/i18n';

type SelectionMessage = {
    type: 'file-manager:selection';
    items: { url: string; name: string }[];
};

function isSelectionMessage(data: unknown): data is SelectionMessage {
    return (
        !!data &&
        typeof data === 'object' &&
        (data as { type?: unknown }).type === 'file-manager:selection'
    );
}

/**
 * * Embeds the real /file-manager page in an iframe (?picker=1[&multiple=1]); picks arrive via `postMessage`
 * * and apply only after "Xác nhận".
 */
export function FilePickerDialog({
    open,
    onOpenChange,
    onPick,
    multiple = false,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** * Always an array, even in single-select mode. */
    onPick: (urls: string[]) => void;
    multiple?: boolean;
}) {
    const [selected, setSelected] = useState<{ url: string; name: string }[]>(
        [],
    );

    useEffect(() => {
        if (!open) {
            setSelected([]);

            return;
        }

        const onMessage = (event: MessageEvent) => {
            if (
                event.origin !== window.location.origin ||
                !isSelectionMessage(event.data)
            ) {
                return;
            }

            setSelected(event.data.items);
        };

        window.addEventListener('message', onMessage);

        return () => window.removeEventListener('message', onMessage);
    }, [open]);

    const picked = selected.map((item) => item.url);

    const confirm = () => {
        if (picked.length > 0) {
            onPick(picked);
            onOpenChange(false);
        }
    };

    const label =
        picked.length === 0
            ? t('file_picker_dialog.no_image_selected')
            : picked.length === 1
              ? t('file_picker_dialog.selected_name', {
                    name: selected[0].name,
                })
              : t('file_picker_dialog.count_images_selected', {
                    count: picked.length,
                });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="flex h-screen max-h-screen w-screen max-w-screen flex-col gap-0 rounded-none p-0 sm:max-w-screen"
            >
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>
                        {t('file_picker_dialog.choose_images_from_the')}
                    </DialogTitle>
                </DialogHeader>

                {open && (
                    <iframe
                        src={`/file-manager?picker=1${multiple ? '&multiple=1' : ''}`}
                        title={t('common.file_library')}
                        className="min-h-0 flex-1 border-0"
                    />
                )}

                <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
                    <span className="truncate text-sm text-muted-foreground">
                        {label}
                    </span>
                    <div className="flex shrink-0 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={picked.length === 0}
                            onClick={confirm}
                        >
                            {t('file_picker_dialog.confirm')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
