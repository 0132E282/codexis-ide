import { useState } from 'react';
import { Button } from '@/components/ui/button';
import InputField from '@/components/form/field/input-field';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { errorText } from '@/lib/ide';
import { t } from '@/lib/i18n';

/** Asks for the authorization code the sign-in page shows once the user logged in (Antigravity); `onSubmit` rejects with the reason when the code is refused. */
export function LoginCodeDialog({
    url,
    onSubmit,
    onCancel,
}: {
    /** The sign-in page, which the backend already opened in the browser. */
    url: string;
    onSubmit: (code: string) => Promise<void>;
    onCancel: () => void;
}) {
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = () => {
        if (code.trim() === '') {
            return;
        }

        setBusy(true);
        setError(null);
        onSubmit(code)
            .catch((caught) => setError(errorText(caught)))
            .finally(() => setBusy(false));
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onCancel()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('login_code_dialog.title')}</DialogTitle>
                    <DialogDescription>
                        {t('login_code_dialog.description')}
                    </DialogDescription>
                </DialogHeader>
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="self-start text-sm underline"
                >
                    {t('login_code_dialog.open_link')}
                </a>
                <InputField
                    name="login-code"
                    value={code}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    aria-label={t('login_code_dialog.code')}
                    placeholder={t('login_code_dialog.placeholder')}
                    onChange={(event) => setCode(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            submit();
                        }
                    }}
                />
                {error !== null && (
                    <p role="alert" className="text-xs text-destructive">
                        {error}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        {t('login_code_dialog.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={busy || code.trim() === ''}
                        onClick={submit}
                    >
                        {t('login_code_dialog.submit')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
