import { GitBranch, GitMerge, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { useCachedRequest } from '@/hooks/use-cached-request';
import { useConfirm } from '@/hooks/use-confirm';
import { api } from '@/lib/api';
import { invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { ide } from '@/lib/ide';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type LocalBranches = {
    git: boolean;
    current: string | null;
    branches: string[];
    worktrees: { name: string; branch: string | null; current: boolean }[];
};

const triggerClass =
    'h-8 max-w-40 min-w-8 gap-1.5 overflow-hidden px-2 text-xs text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:invisible @max-sm/chat:w-0 @max-sm/chat:px-0 @max-sm/chat:opacity-0';

// * In a labelled row (session rail) the row carries the icon, so the trigger is only the name, at the row's right edge.
const rowTriggerClass =
    'h-6 max-w-full min-w-0 justify-end gap-0 overflow-hidden px-1 text-xs font-medium text-foreground';

/** * Name of the branch the person is on, shown next to the trigger icon. */
function BranchName({ name }: { name: string | null | undefined }) {
    return name ? <span className="truncate">{name}</span> : null;
}

function Heading({ children }: { children: ReactNode }) {
    return (
        <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            {children}
        </h3>
    );
}

/** * Branch icon of a folder on this machine: its local branches and git worktrees (names only). Switching, merging and pulling ask git to do it and report its failure. */
export function LocalBranchPopover({
    root,
    inRow = false,
}: {
    root: string;
    /** Drawn as the value of a labelled row: name only, no icon. */
    inRow?: boolean;
}) {
    const { data, failed, mutate } = useLocalBranches(root);

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label={t('branch_popover.branches_and_worktrees')}
                    title={
                        data?.current
                            ? t(
                                  'branch_popover.project_branches_and_worktrees',
                                  {
                                      branch: data.current,
                                  },
                              )
                            : t(
                                  'branch_popover.project_branches_and_worktrees2',
                              )
                    }
                    className={inRow ? rowTriggerClass : triggerClass}
                >
                    {!inRow && (
                        <GitBranch aria-hidden="true" className="size-5" />
                    )}
                    <BranchName name={data?.current} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
                <LocalBranchList
                    root={root}
                    data={data}
                    failed={failed}
                    mutate={mutate}
                />
            </PopoverContent>
        </Popover>
    );
}

const fetchLocalBranches = (root: string) =>
    api
        .get<LocalBranches>('/ai-chat/local/branches', {
            params: { root },
        })
        .then(({ data }) => data);

function useLocalBranches(root: string) {
    return useCachedRequest<LocalBranches>(
        `branches:local:${root}`,
        10_000,
        () => fetchLocalBranches(root),
        true,
    );
}

const errorText = (caught: unknown, fallback: string) =>
    typeof caught === 'string' && caught !== '' ? caught : fallback;

function LocalBranchList({
    root,
    data,
    failed,
    mutate,
}: {
    root: string;
    data: LocalBranches | null;
    failed: boolean;
    mutate: (value: LocalBranches) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const { confirm, dialog } = useConfirm();

    // * Reads the local branches again (no git fetch); F5 does the same while the list is open.
    const reload = async () => {
        if (busy || refreshing) {
            return;
        }

        setRefreshing(true);
        invalidateAiChatCache(`branches:local:${root}`);

        try {
            mutate(await fetchLocalBranches(root));
        } catch {
            toast.error(t('branch_popover.could_not_load_the'));
        } finally {
            setRefreshing(false);
        }
    };
    const reloadRef = useRef(reload);

    useEffect(() => {
        reloadRef.current = reload;
    });

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'F5') {
                event.preventDefault();
                void reloadRef.current();
            }
        };

        window.addEventListener('keydown', onKeyDown);

        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    // * Runs one git write; afterwards the cached list is dropped and read again so the current branch is the real one.
    const run = async (
        work: () => Promise<string>,
        success: (branch: string) => string,
        fallback: string,
    ) => {
        setBusy(true);

        try {
            const branch = await work();

            toast.success(success(branch));
            invalidateAiChatCache(`branches:local:${root}`);

            try {
                mutate(await fetchLocalBranches(root));
            } catch {
                if (data !== null) {
                    mutate({ ...data, current: branch || data.current });
                }
            }
        } catch (caught) {
            toast.error(errorText(caught, fallback));
        } finally {
            setBusy(false);
        }
    };

    const checkout = (branch: string) =>
        run(
            () => ide.gitCheckout(branch, root),
            (current) =>
                t('branch_popover.switched_to_branch', { branch: current }),
            t('branch_popover.could_not_switch'),
        );

    const pull = () =>
        run(
            () => ide.gitPull(root),
            () => t('branch_popover.pulled'),
            t('branch_popover.could_not_pull'),
        );

    const merge = async (branch: string, current: string | null) => {
        if (
            !(await confirm({
                title: t('branch_popover.merge_branch'),
                description: t('branch_popover.merge_branch_into', {
                    branch,
                    current: current ?? 'HEAD',
                }),
                action: t('branch_popover.merge'),
            }))
        ) {
            return;
        }

        await run(
            () => ide.gitMerge(branch, root),
            () => t('branch_popover.merged_branch', { branch }),
            t('branch_popover.could_not_merge'),
        );
    };

    if (data === null) {
        return (
            <p className="px-2 py-3 text-sm text-muted-foreground">
                {failed
                    ? t('branch_popover.could_not_load_the')
                    : t('common.loading')}
            </p>
        );
    }

    if (!data.git) {
        return (
            <p className="px-2 py-3 text-sm text-muted-foreground">
                {t('branch_popover.this_folder_is_not')}
            </p>
        );
    }

    return (
        <div className="flex max-h-80 flex-col overflow-y-auto">
            {dialog}
            <div className="flex items-center justify-between pr-1">
                <Heading>{t('branch_popover.branches')}</Heading>
                <div className="flex items-center">
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={busy || refreshing}
                        onClick={() => void reload()}
                        aria-label={t('branch_popover.reload')}
                        title={t('branch_popover.reload_title')}
                        className="size-6 p-0 text-muted-foreground"
                    >
                        <RefreshCw
                            aria-hidden="true"
                            className={cn(
                                'size-3.5',
                                refreshing &&
                                    'animate-spin motion-reduce:animate-none',
                            )}
                        />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={busy || refreshing}
                        onClick={() => void pull()}
                        title={t('branch_popover.pull_title')}
                        className="h-6 px-2 text-xs"
                    >
                        {t('branch_popover.pull')}
                    </Button>
                </div>
            </div>
            {data.branches.map((branch) =>
                branch === data.current ? (
                    <div
                        key={branch}
                        className="flex items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm font-medium"
                    >
                        <GitBranch
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate">
                            {branch}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                            {t('branch_popover.in_use')}
                        </span>
                    </div>
                ) : (
                    <div
                        key={branch}
                        className="flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-accent/50"
                    >
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => void checkout(branch)}
                            title={t('branch_popover.switch_to_branch')}
                            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left disabled:opacity-50"
                        >
                            <GitBranch
                                aria-hidden="true"
                                className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {branch}
                            </span>
                        </button>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void merge(branch, data.current)}
                            aria-label={t('branch_popover.merge_into_current')}
                            title={t('branch_popover.merge_into_current')}
                            className="size-6 shrink-0 p-0 text-muted-foreground"
                        >
                            <GitMerge aria-hidden="true" className="size-4" />
                        </Button>
                    </div>
                ),
            )}
            {data.worktrees.length > 1 && (
                <>
                    <Heading>Worktree</Heading>
                    {data.worktrees.map((tree) => (
                        <div
                            key={tree.name}
                            className={cn(
                                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                                tree.current && 'bg-accent font-medium',
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {tree.name}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {tree.branch ?? 'detached'}
                            </span>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}
