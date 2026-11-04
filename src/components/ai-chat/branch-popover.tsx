import { GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { useCachedRequest } from '@/hooks/use-cached-request';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type LocalBranches = {
    git: boolean;
    current: string | null;
    branches: string[];
    worktrees: { name: string; branch: string | null; current: boolean }[];
};

const triggerClass =
    'h-8 max-w-40 min-w-8 gap-1.5 overflow-hidden px-2 text-xs text-muted-foreground transition-[width,opacity] duration-200 motion-reduce:transition-none @max-sm/chat:invisible @max-sm/chat:w-0 @max-sm/chat:px-0 @max-sm/chat:opacity-0';

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

/** * Branch icon of a folder on this machine: its local branches and git worktrees (names only). Read-only. */
export function LocalBranchPopover({ root }: { root: string }) {
    const { data, failed } = useLocalBranches(root);

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    aria-label="Nhánh và worktree"
                    title={`Nhánh và worktree của dự án${data?.current ? ` · đang ở ${data.current}` : ''}`}
                    className={triggerClass}
                >
                    <GitBranch aria-hidden="true" />
                    <BranchName name={data?.current} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
                <LocalBranchList data={data} failed={failed} />
            </PopoverContent>
        </Popover>
    );
}

function useLocalBranches(root: string) {
    return useCachedRequest<LocalBranches>(
        `branches:local:${root}`,
        10_000,
        () =>
            api
                .get<LocalBranches>('/ai-chat/local/branches', {
                    params: { root },
                })
                .then(({ data }) => data),
        true,
    );
}

function LocalBranchList({
    data,
    failed,
}: {
    data: LocalBranches | null;
    failed: boolean;
}) {
    if (data === null) {
        return (
            <p className="px-2 py-3 text-sm text-muted-foreground">
                {failed ? 'Không tải được danh sách nhánh.' : 'Đang tải...'}
            </p>
        );
    }

    if (!data.git) {
        return (
            <p className="px-2 py-3 text-sm text-muted-foreground">
                Thư mục này không phải repo git.
            </p>
        );
    }

    return (
        <div className="flex max-h-80 flex-col overflow-y-auto">
            <Heading>Nhánh</Heading>
            {data.branches.map((branch) => (
                <div
                    key={branch}
                    className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                        branch === data.current && 'bg-accent font-medium',
                    )}
                >
                    <GitBranch
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{branch}</span>
                    {branch === data.current && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                            đang dùng
                        </span>
                    )}
                </div>
            ))}
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
