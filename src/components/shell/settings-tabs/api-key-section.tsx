import { useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
                        Khóa API lưu trong cơ sở dữ liệu của Rynox (chỉ chủ máy
                        đọc được) và được truyền cho `claude` khi chat. Khi có
                        khóa, CLI tính phí theo API thay vì gói đăng nhập.
                    </p>
                </div>
                <Badge variant="outline">
                    {status?.set
                        ? `Đã lưu ····${status.hint ?? ''}`
                        : 'Chưa có khóa'}
                </Badge>
            </div>
            <form onSubmit={submit} className="flex gap-2">
                <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={
                        status?.set ? 'Nhập khóa mới để thay thế' : 'sk-ant-...'
                    }
                    aria-label="Khóa Claude API"
                />
                <Button type="submit" disabled={busy || value.trim() === ''}>
                    Lưu
                </Button>
                {status?.set && (
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => run(ideCredentials.remove(NAME))}
                    >
                        Xóa
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
