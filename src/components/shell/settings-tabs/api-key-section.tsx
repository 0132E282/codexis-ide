import { useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Field from '@/components/form/field';
import { t } from '@/lib/i18n';
import { API_KEY_MAX_LENGTH } from '@/lib/limits';
import { errorText } from '@/lib/ide';
import {
    ideCredentials,
    type CredentialName,
    type CredentialStatus,
} from '@/lib/ide-credentials';

const NAME: CredentialName = 'anthropic_api_key';

/** Claude API key: kept in Rynox's own database, write-only here, and given to the `claude` CLI as `ANTHROPIC_API_KEY` for each chat turn. */
export function ApiKeySection() {
    const [status, setStatus] = useState<CredentialStatus | null>(null);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const apply = (all: CredentialStatus[]) =>
        setStatus(all.find((entry) => entry.name === NAME) ?? null);

    useEffect(() => {
        ideCredentials
            .status()
            .then(apply)
            .catch((caught) => setError(errorText(caught)));
    }, []);

    const run = (action: Promise<CredentialStatus[]>) => {
        setBusy(true);
        setError(null);
        action
            .then((all) => {
                apply(all);
                setValue('');
            })
            .catch((caught) => setError(errorText(caught)))
            .finally(() => setBusy(false));
    };

    const submit = (event: FormEvent) => {
        event.preventDefault();
        run(ideCredentials.save(NAME, value));
    };

    return (
        <section className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1 leading-tight">
                    <p className="font-medium">Claude API</p>
                    <p className="text-xs text-muted-foreground">
                        {t('api_key_section.the_api_key_is')}
                    </p>
                </div>
                <Badge variant="outline">
                    {status?.set
                        ? t('api_key_section.saved_hint', {
                              hint: status.hint ?? '',
                          })
                        : t('api_key_section.no_key_yet')}
                </Badge>
            </div>
            <form onSubmit={submit} className="flex gap-2">
                <Field
                    name="api-key"
                    className="min-w-0 flex-1"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    maxLength={API_KEY_MAX_LENGTH}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={
                        status?.set
                            ? t('api_key_section.enter_anew_key')
                            : 'sk-ant-...'
                    }
                    aria-label={t('api_key_section.claude_api_key')}
                />
                <Button type="submit" disabled={busy || value.trim() === ''}>
                    {t('common.save')}
                </Button>
                {status?.set && (
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => run(ideCredentials.remove(NAME))}
                    >
                        {t('common.delete')}
                    </Button>
                )}
            </form>
            {error !== null && (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            )}
        </section>
    );
}
