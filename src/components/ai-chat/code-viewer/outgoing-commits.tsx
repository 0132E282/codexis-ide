import { ArrowUp, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CommitFiles } from '@/components/shell/git-history-commit-files';
import {
    CommitAvatar,
    isProfileAuthor,
} from '@/components/shell/git-history-commit-row';
import { Button } from '@/components/ui/button';
import { requestErrorMessage } from '@/lib/ai-error';
import { t } from '@/lib/i18n';
import { ide } from '@/lib/ide';
import type { GitCommit } from '@/lib/ide';
import { ideAuth } from '@/lib/ide-auth';
import type { GithubProfile } from '@/lib/ide-auth';

/** The commits of the current branch that no remote has yet, with the button that pushes them. `refreshKey` changes whenever the repository may have (a commit was made). */
export function OutgoingCommits({
    root,
    refreshKey,
}: {
    root: string;
    refreshKey: unknown;
}) {
    const [commits, setCommits] = useState<GitCommit[]>([]);
    const [pushing, setPushing] = useState(false);
    const [open, setOpen] = useState(false);
    const [expandedHash, setExpandedHash] = useState<string | null>(null);
    const [pushedTick, setPushedTick] = useState(0);
    const [profile, setProfile] = useState<GithubProfile | null>(null);

    useEffect(() => {
        ideAuth
            .githubProfile()
            .then(setProfile)
            .catch(() => setProfile(null));
    }, []);

    useEffect(() => {
        let cancelled = false;

        ide.gitOutgoing(root)
            .then((found) => !cancelled && setCommits(found))
            .catch(() => !cancelled && setCommits([]));

        return () => {
            cancelled = true;
        };
    }, [root, refreshKey, pushedTick]);

    if (commits.length === 0) {
        return null;
    }

    const push = async () => {
        setPushing(true);

        try {
            await ide.gitPush(root);
            toast.success(t('changes_panel.pushed'));
            setPushedTick((tick) => tick + 1);
        } catch (caught) {
            toast.error(
                requestErrorMessage(caught, t('changes_panel.could_not_push')),
            );
        } finally {
            setPushing(false);
        }
    };

    return (
        <div className="shrink-0 border-b text-sm">
            <div className="flex h-12 items-center gap-1 px-3">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((current) => !current)}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    {open ? (
                        <ChevronDown aria-hidden="true" className="size-4" />
                    ) : (
                        <ChevronRight aria-hidden="true" className="size-4" />
                    )}
                    <span className="truncate">
                        {t('changes_panel.outgoing')}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                        {commits.length}
                    </span>
                </button>
                <Button
                    type="button"
                    size="sm"
                    className="shrink-0"
                    disabled={pushing}
                    onClick={() => void push()}
                >
                    {pushing ? (
                        <Loader2
                            aria-hidden="true"
                            className="animate-spin motion-reduce:animate-none"
                        />
                    ) : (
                        <ArrowUp aria-hidden="true" />
                    )}
                    {t('changes_panel.push', { count: commits.length })}
                </Button>
            </div>
            {open && (
                <ul className="max-h-72 min-h-0 min-w-0 space-y-0.5 overflow-y-auto px-2 pb-2">
                    {commits.map((commit) => (
                        <li key={commit.hash} className="min-w-0 text-xs">
                            <button
                                type="button"
                                aria-expanded={expandedHash === commit.hash}
                                onClick={() =>
                                    setExpandedHash((current) =>
                                        current === commit.hash
                                            ? null
                                            : commit.hash,
                                    )
                                }
                                className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-accent/50 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                {expandedHash === commit.hash ? (
                                    <ChevronDown
                                        aria-hidden="true"
                                        className="size-4 shrink-0 text-muted-foreground"
                                    />
                                ) : (
                                    <ChevronRight
                                        aria-hidden="true"
                                        className="size-4 shrink-0 text-muted-foreground"
                                    />
                                )}
                                <CommitAvatar
                                    key={commit.authorEmail}
                                    name={commit.authorName}
                                    email={commit.authorEmail}
                                    ownAvatar={
                                        profile !== null &&
                                        isProfileAuthor(commit, profile)
                                            ? profile.avatar
                                            : ''
                                    }
                                    sizeClassName="size-4"
                                />
                                <code className="w-[7ch] shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                                    {commit.shortHash}
                                </code>
                                <span
                                    className="min-w-0 flex-1 truncate"
                                    title={commit.subject}
                                >
                                    {commit.subject}
                                </span>
                            </button>
                            {expandedHash === commit.hash && (
                                <div className="ml-3 border-l pl-1">
                                    <CommitFiles
                                        root={root}
                                        hash={commit.hash}
                                        indentClassName="pl-1"
                                        className="max-h-40 min-w-0 overflow-y-auto"
                                    />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
