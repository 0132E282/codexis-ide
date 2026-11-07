import { ArrowUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
        <div className="space-y-2 border-b px-3 py-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
                {t('changes_panel.outgoing')}
                <span className="text-muted-foreground tabular-nums">
                    {commits.length}
                </span>
            </p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                {commits.map((commit) => (
                    <li
                        key={commit.hash}
                        className="flex min-w-0 items-center gap-2 text-xs"
                    >
                        <code className="shrink-0 text-muted-foreground">
                            {commit.shortHash}
                        </code>
                        <span className="min-w-0 truncate">
                            {commit.subject}
                        </span>
                    </li>
                ))}
            </ul>
            <Button
                type="button"
                size="sm"
                className="w-full"
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
    );
}
