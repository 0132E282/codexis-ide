import { ChartColumn, EllipsisVertical, Github, Settings } from 'lucide-react';
import { useState } from 'react';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AuthStatus } from '@/lib/ide-auth';
import { t } from '@/lib/i18n';

/** The GitHub avatar of the signed-in account; the GitHub mark while the account is unknown or the picture cannot be loaded. */
function GithubAvatar({ account }: { account: string | null }) {
    const [failed, setFailed] = useState(false);

    if (account === null || failed) {
        return (
            <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
            >
                <Github className="size-4" />
            </span>
        );
    }

    return (
        <img
            src={`https://github.com/${encodeURIComponent(account)}.png?size=64`}
            alt=""
            aria-hidden="true"
            onError={() => setFailed(true)}
            className="size-7 shrink-0 rounded-full object-cover"
        />
    );
}

/** The account footer: the signed-in GitHub account (or the app name) and the menu with the sign-in, chat settings and statistics. */
export function SidebarFooter({
    github,
    onOpenSettings,
    onOpenUsage,
}: {
    github: AuthStatus | undefined;
    onOpenSettings: (tab: SettingsTab) => void;
    onOpenUsage: () => void;
}) {
    return (
        <div className="flex items-center gap-2 border-t px-3 py-2.5">
            {github?.loggedIn ? (
                // * Signed in with GitHub: the footer shows the account's GitHub avatar.
                <GithubAvatar account={github.account} />
            ) : (
                <AssistantAvatar />
            )}
            <p className="min-w-0 flex-1 truncate text-sm">
                {github?.loggedIn
                    ? (github.account ?? t('accounts.signed_in'))
                    : 'Codexis'}
            </p>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('common.add')}
                        className="text-muted-foreground"
                    >
                        <EllipsisVertical aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                    {github?.loggedIn ? (
                        <DropdownMenuItem disabled>
                            <Github aria-hidden="true" />
                            {t('sidebar.github_signed_in', {
                                account:
                                    github.account ?? t('accounts.signed_in'),
                            })}
                        </DropdownMenuItem>
                    ) : (
                        // * The sign-in itself is the "Kết nối" tab: GitHub's own `gh` login, which shows the one-time code there.
                        <DropdownMenuItem
                            onSelect={() => onOpenSettings('connect')}
                        >
                            <Github aria-hidden="true" />
                            {t('sidebar.sign_in_with_github')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                        onSelect={() => onOpenSettings('character')}
                    >
                        <Settings aria-hidden="true" />
                        {t('common.chat_settings')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onOpenUsage}>
                        <ChartColumn aria-hidden="true" />
                        {t('sidebar.statistics')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
