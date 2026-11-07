import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
    Check,
    ChevronDown,
    ChevronsDownUp,
    List,
    MoreHorizontal,
    PanelRightOpen,
    Search,
    X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { PanelMenu } from '@/components/shell/panel-menu';
import { LoadingRows } from '@/components/ai-chat/loading-rows';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import type {
    PanelPlacement,
    usePanelPlacement,
} from '@/hooks/use-panel-placement';
import type { useResizableWidth } from '@/hooks/use-resizable-width';
import type { AiChatProposal } from '@/types';
import { TREE_MAX_WIDTH } from './constants';
import { TreeItems } from './tree-items';
import type { TreeNode } from './tree';

// * Top and bottom are not offered: the tree stays beside the editor.
const TREE_EDGES = ['left', 'right'] as const;

/** * The far-right column, like an editor's explorer: project switcher, header buttons, the Files / Changes switch, the filter and the file tree. */
export function TreePanel({
    sourceName,
    treeWidth,
    placement,
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
    onCollapseAll,
    onReload,
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
    /** Left or right of the editor (the Move menu); Fill is the maximize below. */
    placement: ReturnType<typeof usePanelPlacement>;
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
    onCollapseAll: () => void;
    onReload: () => void;
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
    const filterInput = useRef<HTMLInputElement>(null);
    const widthBeforeMaximize = useRef<number | null>(null);
    const [isClosed, setIsClosed] = useState(false);
    const isMaximized = treeWidth.width >= TREE_MAX_WIDTH;

    const toggleMaximize = () => {
        if (isMaximized) {
            treeWidth.setTo(widthBeforeMaximize.current ?? 256);
            widthBeforeMaximize.current = null;

            return;
        }

        widthBeforeMaximize.current = treeWidth.width;
        treeWidth.setTo(TREE_MAX_WIDTH);
    };

    const onLeft = placement.placement === 'left';

    // * The shared menu: Fill is the existing maximize; Move and Arrange pick the side of the editor.
    const changePlacement = (next: PanelPlacement) => {
        if ((next === 'fill') !== isMaximized) {
            toggleMaximize();
        }

        if (next !== 'fill') {
            placement.setPlacement(next);
        }
    };

    if (isClosed) {
        return (
            <aside
                aria-label={t('tree_panel.file_tree_name', {
                    name: sourceName,
                })}
                className={cn(
                    'hidden w-10 shrink-0 flex-col items-center pt-2 md:flex',
                    onLeft ? 'mr-auto border-r' : 'ml-auto border-l',
                )}
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('tree_panel.open')}
                    title={t('tree_panel.open')}
                    onClick={() => setIsClosed(false)}
                    className="text-muted-foreground"
                >
                    <PanelRightOpen aria-hidden="true" />
                </Button>
            </aside>
        );
    }

    return (
        <aside
            aria-label={t('tree_panel.file_tree_name', { name: sourceName })}
            style={{ width: treeWidth.width }}
            className={cn(
                'relative hidden min-h-0 max-w-full shrink-0 flex-col md:flex',
                onLeft ? 'mr-auto border-r' : 'ml-auto border-l',
            )}
        >
            <ResizeHandle
                label={t('tree_panel.resize_file_tree')}
                className={cn(onLeft && 'right-0 left-auto translate-x-1/2')}
                {...treeWidth.handleProps}
            />
            <div
                role="toolbar"
                aria-label={t('tree_panel.tools')}
                className="flex h-12 shrink-0 items-center gap-0.5 border-b px-2"
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('tree_panel.search')}
                    title={t('tree_panel.search')}
                    onClick={() => filterInput.current?.focus()}
                    className="text-muted-foreground"
                >
                    <Search aria-hidden="true" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('tree_panel.collapse_all')}
                    title={t('tree_panel.collapse_all')}
                    onClick={onCollapseAll}
                    className="text-muted-foreground"
                >
                    <ChevronsDownUp aria-hidden="true" />
                </Button>
                {isLocal && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('tree_panel.toggle_view')}
                        title={t('tree_panel.toggle_view')}
                        aria-pressed={view === 'changes'}
                        onClick={() =>
                            onViewChange(view === 'files' ? 'changes' : 'files')
                        }
                        // * `sm` (not `icon-sm`): the button grows to fit the count, so the number is not squeezed against the icon.
                        className={cn(
                            'min-w-8 gap-1 px-2',
                            view === 'changes'
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground',
                        )}
                    >
                        <List aria-hidden="true" className="size-4" />
                        {changedFileCount > 0 && (
                            <span className="text-xs leading-none tabular-nums">
                                {changedFileCount}
                            </span>
                        )}
                    </Button>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('tree_panel.more')}
                            title={t('tree_panel.more')}
                            className="text-muted-foreground"
                        >
                            <MoreHorizontal aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={onReload}>
                            {t('tree_panel.reload')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <span className="ml-auto flex items-center gap-0.5">
                    <PanelMenu
                        placement={isMaximized ? 'fill' : placement.placement}
                        dockedPlacement={placement.dockedPlacement}
                        edges={TREE_EDGES}
                        onPlacementChange={changePlacement}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('tree_panel.close')}
                        title={t('tree_panel.close')}
                        onClick={() => setIsClosed(true)}
                        className="text-muted-foreground"
                    >
                        <X aria-hidden="true" />
                    </Button>
                </span>
            </div>
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
            <nav
                aria-label={t('tree_panel.file_tree')}
                className="flex min-h-0 flex-1 flex-col gap-2 p-2"
            >
                <Input
                    ref={filterInput}
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
