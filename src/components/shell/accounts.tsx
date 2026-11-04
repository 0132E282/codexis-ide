import { useEffect, useState, type ReactNode } from 'react';
import logo from '@/assets/logo.png';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiKeySection } from '@/components/shell/settings-tabs/api-key-section';
import { ManageAccountsPage } from '@/components/shell/manage-accounts-page';
import { errorText } from '@/lib/ide';
import { ideAuth, type AuthProvider, type AuthStatus } from '@/lib/ide-auth';
import { ideProfiles } from '@/lib/ide-profiles';

const LABEL: Record<AuthProvider, string> = {
    claude: 'Claude',
    codex: 'ChatGPT (Codex)',
    github: 'GitHub',
};

const INSTALL_HINT: Record<AuthProvider, string> = {
    claude: 'Chưa cài lệnh `claude`.',
    codex: 'Chưa cài lệnh `codex`.',
    github: 'Chưa cài GitHub CLI (`gh`).',
};

type AccountCount = { connected: number; total: number };

/** Per tool, how many of its accounts are connected out of all of them; read again when a sign-in state changes. */
function useAccountCounts(statuses: AuthStatus[]) {
    const [counts, setCounts] = useState<
        Partial<Record<AuthProvider, AccountCount>>
    >({});
    const key = statuses
        .map((status) => `${status.provider}:${status.loggedIn}`)
        .join(',');

    useEffect(() => {
        let cancelled = false;

        ideProfiles
            .list()
            .then(async (all) => {
                const read = await Promise.all(
                    all.map((profile) =>
                        ideAuth
                            .statusProfile(profile.cli, profile.id)
                            .then((state) => ({
                                cli: profile.cli,
                                connected: state.loggedIn,
                            })),
                    ),
                );
                const next: Partial<Record<AuthProvider, AccountCount>> = {};

                for (const item of read) {
                    const count = next[item.cli] ?? {
                        connected: 0,
                        total: 0,
                    };

                    count.total += 1;
                    count.connected += item.connected ? 1 : 0;
                    next[item.cli] = count;
                }

                if (!cancelled) {
                    setCounts(next);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [key]);

    return counts;
}

/** One row per tool: state, and a button that starts the tool's own login in the browser. */
function AccountRow({
    status,
    onChanged,
    onManage,
    count,
}: {
    status: AuthStatus;
    onChanged: () => void;
    onManage: () => void;
    /** Accounts connected out of all accounts of this tool; unknown until read. */
    count: { connected: number; total: number } | undefined;
}) {
    const [busy, setBusy] = useState(false);
    const [code, setCode] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const connect = () => {
        setBusy(true);
        setError(null);
        setCode(null);
        ideAuth
            .login(status.provider)
            .then((oneTimeCode) => {
                setCode(oneTimeCode);
                onChanged();
            })
            .catch((caught) => setError(errorText(caught)))
            .finally(() => setBusy(false));
    };

    return (
        <li className="flex flex-col gap-1 rounded-md border p-3">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onManage}
                    aria-label={`Quản lý tài khoản ${LABEL[status.provider]}`}
                    className="min-w-0 flex-1 rounded-sm text-left leading-tight hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    <p className="font-medium">{LABEL[status.provider]}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {!status.installed
                            ? INSTALL_HINT[status.provider]
                            : status.loggedIn
                              ? (status.account ?? 'Đã đăng nhập')
                              : 'Đăng nhập trong trình duyệt, Rynox không thấy mật khẩu.'}
                    </p>
                </button>
                {count !== undefined && (
                    <span
                        title="Số tài khoản đang kết nối"
                        className="shrink-0 text-xs text-muted-foreground tabular-nums"
                    >
                        {count.connected}/{count.total} kết nối
                    </span>
                )}
                {!(status.installed && status.loggedIn) && (
                    <Badge variant="outline" className="gap-1.5">
                        <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-muted-foreground/60"
                        />
                        {!status.installed ? 'Chưa cài' : 'Chưa kết nối'}
                    </Badge>
                )}
                {status.installed && !status.loggedIn && (
                    <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={connect}
                    >
                        {status.provider === 'github' ? 'Kết nối' : 'Đăng nhập'}
                    </Button>
                )}
            </div>
            {code !== null && (
                <p className="text-xs">
                    Nhập mã <strong className="font-mono">{code}</strong> tại
                    github.com/login/device (trình duyệt sẽ tự mở).
                </p>
            )}
            {error !== null && (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            )}
        </li>
    );
}

export function AccountList({
    statuses,
    onChanged,
    intro,
    onSubpage,
}: {
    statuses: AuthStatus[];
    onChanged: () => void;
    /** Shown above the list only, so the in-place pages start at the top. */
    intro?: ReactNode;
    /** Told whether a page (manage, detail) replaces the list, so the host can drop its own title. */
    onSubpage?: (open: boolean) => void;
}) {
    // * "Quản lý tài khoản" replaces the list with the manage page in place, no popup.
    const [managing, setManaging] = useState<AuthProvider | null>(null);

    const subpage = managing !== null;
    const counts = useAccountCounts(statuses);

    useEffect(() => {
        onSubpage?.(subpage);

        return () => onSubpage?.(false);
    }, [subpage, onSubpage]);

    if (managing !== null) {
        return (
            <ManageAccountsPage
                cli={managing}
                title={LABEL[managing]}
                onBack={() => setManaging(null)}
                onChanged={onChanged}
                apiKey={managing === 'claude' ? <ApiKeySection /> : undefined}
            />
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {intro}
            <ul className="flex flex-col gap-2">
                {statuses.map((status) => (
                    <AccountRow
                        key={status.provider}
                        status={status}
                        onChanged={onChanged}
                        onManage={() => setManaging(status.provider)}
                        count={counts[status.provider]}
                    />
                ))}
            </ul>
        </div>
    );
}

/** Full-screen gate shown until at least one AI CLI is signed in. */
export function LoginScreen({
    statuses,
    error,
    onChanged,
}: {
    statuses: AuthStatus[] | null;
    error: string | null;
    onChanged: () => void;
}) {
    return (
        <div className="flex h-screen items-center justify-center bg-background p-6 text-sm text-foreground">
            <div className="flex w-full max-w-md flex-col gap-4">
                <div className="flex items-center gap-3">
                    <img src={logo} alt="" className="size-10" />
                    <div className="leading-tight">
                        <h1 className="text-lg font-semibold">
                            Đăng nhập Rynox
                        </h1>
                        <p className="text-muted-foreground">
                            Đăng nhập ít nhất một CLI AI (Claude hoặc Codex) để
                            tiếp tục. GitHub là tùy chọn.
                        </p>
                    </div>
                </div>
                {error !== null && (
                    <p role="alert" className="text-destructive">
                        {error}
                    </p>
                )}
                {statuses === null ? (
                    <p className="text-muted-foreground">
                        Đang kiểm tra đăng nhập...
                    </p>
                ) : (
                    <AccountList statuses={statuses} onChanged={onChanged} />
                )}
                <Button type="button" variant="outline" onClick={onChanged}>
                    Kiểm tra lại
                </Button>
            </div>
        </div>
    );
}
