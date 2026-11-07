import { ArrowUp, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CommitFiles } from '@/components/shell/git-history-commit-files';
import { Button } from '@/components/ui/button';
import { requestErrorMessage } from '@/lib/ai-error';
import { t } from '@/lib/i18n';
import { ide } from '@/lib/ide';
import type { GitCommit } from '@/lib/ide';

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
            <div className="flex items-center gap-1 px-3 py-1.5">
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
                <ul className="max-h-64 space-y-0.5 overflow-y-auto px-3 pb-2 pl-5">
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
                                className="flex w-full min-w-0 items-center gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                {expandedHash === commit.hash ? (
                                    <ChevronDown
                                        aria-hidden="true"
                                        className="size-3 shrink-0"
                                    />
                                ) : (
                                    <ChevronRight
                                        aria-hidden="true"
                                        className="size-3 shrink-0"
                                    />
                                )}
                                <code className="shrink-0 text-muted-foreground">
                                    {commit.shortHash}
                                </code>
                                <span className="min-w-0 truncate">
                                    {commit.subject}
                                </span>
                            </button>
                            {expandedHash === commit.hash && (
                                <CommitFiles root={root} hash={commit.hash} />
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
