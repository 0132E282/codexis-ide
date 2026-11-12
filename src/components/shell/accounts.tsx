import { Github } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import logo from '@/assets/logo.png';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiKeySection } from '@/components/shell/settings-tabs/api-key-section';
import { AntigravityIcon, ClaudeIcon, CodexIcon, GeminiIcon } from '@/icons';
import { errorText } from '@/lib/ide';
import { ideAuth, type AuthProvider, type AuthStatus } from '@/lib/ide-auth';
import { ideProfiles } from '@/lib/ide-profiles';
import { LoginCodeDialog } from '@/components/shell/login-code-dialog';
import { t } from '@/lib/i18n';

// * The manage page only opens from a row's "Manage" button, so it is fetched then.
const ManageAccountsPage = lazy(() =>
    import('@/components/shell/manage-accounts-page').then((module) => ({
        default: module.ManageAccountsPage,
    })),
);

const LABEL: Record<AuthProvider, string> = {
    claude: 'Claude',
    codex: 'ChatGPT (Codex)',
    gemini: 'Gemini',
    antigravity: 'Antigravity',
    github: 'GitHub',
};

const ICON: Record<AuthProvider, ReactNode> = {
    claude: <ClaudeIcon aria-hidden="true" className="size-5 shrink-0" />,
    codex: <CodexIcon className="size-5 shrink-0 rounded-sm" />,
    gemini: <GeminiIcon aria-hidden="true" className="size-5 shrink-0" />,
    antigravity: (
        <AntigravityIcon aria-hidden="true" className="size-5 shrink-0" />
    ),
    github: (
        <Github
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
        />
    ),
};

const INSTALL_HINT: Record<AuthProvider, string> = {
    claude: 'accounts.the_claude_command_is',
    codex: 'accounts.the_codex_command_is',
    gemini: 'accounts.the_gemini_command_is',
    antigravity: 'accounts.the_antigravity_command_is',
    github: 'accounts.github_cli_gh_is',
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
    // * Antigravity's login ends by pasting the code of its sign-in page.
    const [codeUrl, setCodeUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const connect = () => {
        setBusy(true);
        setError(null);
        setCode(null);
        ideAuth
            .login(status.provider)
            .then((shown) => {
                if (status.provider === 'antigravity' && shown !== null) {
                    setCodeUrl(shown);
                } else {
                    setCode(shown);
                }

                onChanged();
            })
            .catch((caught) => setError(errorText(caught)))
            .finally(() => setBusy(false));
    };

    return (
        <li className="flex flex-col gap-1 rounded-md border p-3">
            <div className="flex items-center gap-3">
                {ICON[status.provider]}
                <button
                    type="button"
                    onClick={onManage}
                    aria-label={t('common.manage_name_accounts', {
                        name: LABEL[status.provider],
                    })}
                    className="min-w-0 flex-1 rounded-sm text-left leading-tight hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    <p className="font-medium">{LABEL[status.provider]}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {!status.installed
                            ? t(INSTALL_HINT[status.provider])
                            : status.loggedIn
                              ? (status.account ?? t('accounts.signed_in'))
                              : t('accounts.sign_in_through_the')}
                    </p>
                </button>
                {count !== undefined && (
                    <span
                        title={t('accounts.number_of_connected_accounts')}
                        className="shrink-0 text-xs text-muted-foreground tabular-nums"
                    >
                        {t('accounts.connected_total_connected', {
                            connected: count.connected,
                            total: count.total,
                        })}
                    </span>
                )}
                {!(status.installed && status.loggedIn) && (
                    <Badge variant="outline" className="gap-1.5">
                        <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-muted-foreground/60"
                        />
                        {!status.installed
                            ? t('common.not_installed')
                            : t('common.not_connected')}
                    </Badge>
                )}
                {status.installed && !status.loggedIn && (
                    <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={connect}
                    >
                        {status.provider === 'github'
                            ? t('common.connect')
                            : t('common.sign_in')}
                    </Button>
                )}
            </div>
            {codeUrl !== null && (
                <LoginCodeDialog
                    url={codeUrl}
                    onSubmit={(typed) =>
                        ideAuth
                            .submitCode(status.provider, undefined, typed)
                            .then(() => {
                                setCodeUrl(null);
                                onChanged();
                            })
                    }
                    onCancel={() => {
                        void ideAuth
                            .cancelLogin(status.provider)
                            .catch(() => undefined);
                        setCodeUrl(null);
                    }}
                />
            )}
            {code !== null && (
                <p className="text-xs">
                    {t('common.enter_the_code')}{' '}
                    <strong className="font-mono">{code}</strong>{' '}
                    {t('common.at_github_com_login')}
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
            <Suspense fallback={null}>
                <ManageAccountsPage
                    cli={managing}
                    title={LABEL[managing]}
                    onBack={() => setManaging(null)}
                    onChanged={onChanged}
                    apiKey={
                        managing === 'claude' ? <ApiKeySection /> : undefined
                    }
                />
            </Suspense>
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
                            {t('accounts.sign_in_to_rynox')}
                        </h1>
                        <p className="text-muted-foreground">
                            {t('accounts.sign_in_to_at')}
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
                        {t('accounts.checking_sign_in')}
                    </p>
                ) : (
                    <AccountList statuses={statuses} onChanged={onChanged} />
                )}
                <Button type="button" variant="outline" onClick={onChanged}>
                    {t('accounts.check_again')}
                </Button>
            </div>
        </div>
    );
}
