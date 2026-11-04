import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

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
            ? 'Chưa chọn ảnh nào'
            : picked.length === 1
              ? `Đã chọn: ${selected[0].name}`
              : `Đã chọn ${picked.length} ảnh`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="flex h-screen max-h-screen w-screen max-w-screen flex-col gap-0 rounded-none p-0 sm:max-w-screen"
            >
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>Chọn ảnh từ thư viện file</DialogTitle>
                </DialogHeader>

                {open && (
                    <iframe
                        src={`/file-manager?picker=1${multiple ? '&multiple=1' : ''}`}
                        title="Thư viện file"
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
                            Hủy
                        </Button>
                        <Button
                            type="button"
                            disabled={picked.length === 0}
                            onClick={confirm}
                        >
                            Xác nhận
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
