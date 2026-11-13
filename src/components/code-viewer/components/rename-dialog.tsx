import { t } from '@/lib/i18n';
import { ENTRY_NAME_MAX_LENGTH, hasPathSeparator } from '@/lib/limits';
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
import Field from '@/components/form/field';

/** * Asks for the new name of a file; `onRename` rejects with the reason (name taken, not allowed), shown under the box. */
export function RenameDialog({
    path,
    onClose,
    onRename,
}: {
    /** * The file being renamed (null: closed). */
    path: string | null;
    onClose: () => void;
    onRename: (path: string, newName: string) => Promise<void>;
}) {
    const current = path?.split('/').pop() ?? '';
    const [name, setName] = useState(current);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setName(current);
        setError(null);
    }, [current, path]);

    const submit = async () => {
        if (path === null || busy) {
            return;
        }

        if (name.trim() === '' || name.trim() === current) {
            onClose();

            return;
        }

        if (hasPathSeparator(name)) {
            setError(t('errors.validation.forbidden_char'));

            return;
        }

        setBusy(true);
        setError(null);

        try {
            await onRename(path, name.trim());
            onClose();
        } catch (caught) {
            setError(
                typeof caught === 'string'
                    ? caught
                    : caught instanceof Error
                      ? caught.message
                      : t('rename_dialog.could_not_rename'),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open={path !== null}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('rename_dialog.rename_file')}</DialogTitle>
                    <DialogDescription className="truncate">
                        {path}
                    </DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                    className="space-y-3"
                >
                    <Field
                        name="rename-dialog-name"
                        autoFocus
                        value={name}
                        aria-label={t('rename_dialog.new_name')}
                        autoComplete="off"
                        maxLength={ENTRY_NAME_MAX_LENGTH}
                        onFocus={(event) => {
                            // * The extension stays out of the way: the base name is what usually changes.
                            const input = event.currentTarget;
                            const dot = input.value.lastIndexOf('.');

                            if (input instanceof HTMLInputElement) {
                                input.setSelectionRange(
                                    0,
                                    dot > 0 ? dot : input.value.length,
                                );
                            }
                        }}
                        onChange={(event) => setName(event.target.value)}
                    />
                    {error !== null && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button type="submit" disabled={busy}>
                            {t('common.rename')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
