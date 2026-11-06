import { t } from '@/lib/i18n';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingRows } from '@/components/ai-chat/loading-rows';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import type { useResizableWidth } from '@/hooks/use-resizable-width';
import type { AiChatProposal } from '@/types';
import { TreeItems } from './tree-items';
import type { TreeNode } from './tree';

/** * The far-right column, like an editor's explorer: project switcher, header buttons, the Files / Changes switch, the filter and the file tree. */
export function TreePanel({
    sourceName,
    treeWidth,
    repo,
    repos,
    onViewRepo,
    headerActions,
    isLocal,
    view,
    onViewChange,
    changedFileCount,
    filter,
    onFilterChange,
    paths,
    error,
    tree,
    openDirs,
    onToggle,
    selected,
    onSelect,
    marked,
    onMark,
    onAttach,
    changed,
    changedDirs,
    actions,
}: {
    sourceName: string;
    treeWidth: ReturnType<typeof useResizableWidth>;
    repo: string;
    repos: string[];
    onViewRepo: (repo: string) => void;
    headerActions?: ReactNode;
    /** * Local projects also have the Changes view. */
    isLocal: boolean;
    view: 'files' | 'changes';
    onViewChange: (view: 'files' | 'changes') => void;
    /** * How many files git sees as changed (local projects). */
    changedFileCount: number;
    filter: string;
    onFilterChange: (filter: string) => void;
    /** * The project's paths, null while the tree is loading. */
    paths: string[] | null;
    error: string | null;
    tree: TreeNode[];
    openDirs: Set<string>;
    onToggle: (path: string) => void;
    selected: string | null;
    onSelect: (path: string) => void;
    marked: Set<string>;
    onMark: (path: string) => void;
    onAttach?: (path: string) => void;
    changed: Map<string, AiChatProposal['action']>;
    changedDirs: Set<string>;
    actions: FileActions;
}) {
    return (
        <aside
            aria-label={t('tree_panel.file_tree_name', { name: sourceName })}
            style={{ width: treeWidth.width }}
            className="relative ml-auto hidden min-h-0 max-w-full shrink-0 flex-col border-l md:flex"
        >
            <ResizeHandle
                label={t('tree_panel.resize_file_tree')}
                {...treeWidth.handleProps}
            />
            {(repos.length > 1 || headerActions) && (
                <header className="flex h-12 items-center gap-2 border-b px-3">
                    {repos.length > 1 ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={t(
                                        'tree_panel.choose_aproject_to',
                                    )}
                                    className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <span className="truncate">
                                        {sourceName}
                                    </span>
                                    <ChevronDown
                                        aria-hidden="true"
                                        className="size-4 shrink-0 text-muted-foreground"
                                    />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                {repos.map((item) => (
                                    <DropdownMenuItem
                                        key={item}
                                        onSelect={() => onViewRepo(item)}
                                        className="justify-between gap-3"
                                    >
                                        <span className="truncate">
                                            {item.startsWith('local:')
                                                ? t(
                                                      'common.local_machine_name',
                                                      {
                                                          name: item.slice(6),
                                                      },
                                                  )
                                                : item}
                                        </span>
                                        {item === repo && (
                                            <Check aria-hidden="true" />
                                        )}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : null}
                    <span className="mx-auto flex shrink-0 items-center gap-0.5">
                        {headerActions}
                    </span>
                </header>
            )}
            {isLocal && (
                <Tabs
                    value={view}
                    onValueChange={(value) =>
                        onViewChange(value === 'changes' ? 'changes' : 'files')
                    }
                    className="border-b px-2 py-1.5"
                >
                    <TabsList className="h-8 w-full">
                        <TabsTrigger value="files" className="text-xs">
                            {t('common.files')}
                        </TabsTrigger>
                        <TabsTrigger value="changes" className="text-xs">
                            {t('common.changes')}
                            {changedFileCount > 0 && (
                                <span className="ml-1 tabular-nums">
                                    {changedFileCount}
                                </span>
                            )}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            )}
            <nav
                aria-label={t('tree_panel.file_tree')}
                className="flex min-h-0 flex-1 flex-col gap-2 p-2"
            >
                <Input
                    value={filter}
                    onChange={(event) => onFilterChange(event.target.value)}
                    aria-label={t('tree_panel.filter_files')}
                    placeholder={t('tree_panel.filter_files2')}
                    className="h-8"
                />
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {paths === null ? (
                        <LoadingRows rows={10} className="px-2" />
                    ) : error !== null ? (
                        <p
                            role="alert"
                            className="px-2 text-sm text-destructive"
                        >
                            {error}
                        </p>
                    ) : tree.length === 0 ? (
                        <p className="px-2 text-sm text-muted-foreground">
                            {t('tree_panel.no_files')}
                        </p>
                    ) : (
                        <TreeItems
                            nodes={tree}
                            depth={0}
                            openDirs={openDirs}
                            onToggle={onToggle}
                            selected={selected}
                            onSelect={onSelect}
                            marked={marked}
                            onAttach={onAttach}
                            onMark={onMark}
                            changed={changed}
                            changedDirs={changedDirs}
                            actions={actions}
                        />
                    )}
                </div>
            </nav>
        </aside>
    );
}
