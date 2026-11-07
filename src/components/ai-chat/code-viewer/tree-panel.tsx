import { toast } from 'sonner';
import { FileIcon } from '@/components/ai-chat/file-icon';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ide } from '@/lib/ide';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
    Check,
    ChevronDown,
    ChevronsDownUp,
    List,
    MoreHorizontal,
    PanelRightOpen,
    Plus,
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
import { Field } from '@/components/form';
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
    closed,
    onClosedChange,
}: {
    /** The host holds the closed state and draws the button that opens the tree again (the chat grid puts it in its header): closed, the tree draws nothing. */
    closed?: boolean;
    onClosedChange?: (closed: boolean) => void;
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
    const [ownClosed, setOwnClosed] = useState(false);
    const isClosed = closed ?? ownClosed;
    const setIsClosed = onClosedChange ?? setOwnClosed;
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
    const isFloating = placement.placement === 'float';
    // * Where a new file or folder is being named (folder: empty is the project root), and the name typed so far.
    const [creating, setCreating] = useState<{
        folder: string;
        isFolder: boolean;
    } | null>(null);
    const [newName, setNewName] = useState('');
    const localRoot = repo.startsWith('local:') ? repo.slice(6) : null;

    const startCreate = (folder: string, isFolder: boolean) => {
        setNewName('');
        setCreating({ folder, isFolder });

        // * The folder opens so the name row shows inside it.
        if (folder !== '' && !openDirs.has(folder)) {
            onToggle(folder);
        }
    };

    const submitCreate = async () => {
        const name = newName.trim();

        if (creating === null || name === '') {
            setCreating(null);

            return;
        }

        if (name.includes('/')) {
            toast.error(t('common.name_has_slash'));

            return;
        }

        try {
            const created = await ide.workspaceCreate(
                creating.folder,
                name,
                creating.isFolder,
                localRoot ?? undefined,
            );

            setCreating(null);
            onReload();

            if (!creating.isFolder) {
                onSelect(created);
            }
        } catch (caught) {
            toast.error(
                t(
                    typeof caught === 'string'
                        ? caught
                        : 'common.something_went_wrong',
                ),
            );
        }
    };

    const createRow = (depth: number) => (
        <li key="new-entry" role="none">
            <form
                // * Focused a moment after it appears, once the menu that opened it has finished giving the focus back.
                ref={(form) => {
                    if (form !== null) {
                        window.setTimeout(
                            () => form.querySelector('input')?.focus(),
                            60,
                        );
                    }
                }}
                onSubmit={(event) => {
                    event.preventDefault();
                    void submitCreate();
                }}
                style={{ paddingLeft: `${depth * 12 + 8 + 20}px` }}
                className="flex items-center gap-1.5 py-0.5 pr-2"
            >
                <FileIcon name={newName} dir={creating?.isFolder ?? false} />
                <Field
                    name="new-entry-name"
                    className="min-w-0 flex-1 [&_input]:h-7 [&_input]:text-sm"
                    value={newName}
                    autoComplete="off"
                    aria-label={
                        creating?.isFolder
                            ? t('common.new_folder_name')
                            : t('common.new_file_name')
                    }
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setCreating(null);
                        }
                    }}
                    onBlur={() => setCreating(null)}
                />
            </form>
        </li>
    );
    // * Menus of the rows (and the empty area) start entries through the shared actions.
    const treeActions: FileActions = {
        ...actions,
        create: isLocal ? startCreate : undefined,
    };

    // * The shared menu: Fill is the existing maximize; Move and Arrange pick the side of the editor.
    const changePlacement = (next: PanelPlacement) => {
        if ((next === 'fill') !== isMaximized) {
            toggleMaximize();
        }

        if (next !== 'fill') {
            placement.setPlacement(next);
        }
    };

    if (isClosed && closed !== undefined) {
        return null;
    }

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
                // * Floating: a card over the window (it stays mounted, and takes no room from the editor).
                isFloating
                    ? 'bg-background fixed top-16 right-4 bottom-4 z-30 rounded-lg border shadow-xl'
                    : onLeft
                      ? 'mr-auto border-r'
                      : 'ml-auto border-l',
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
                {isLocal && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('common.create_new')}
                                title={t('common.create_new')}
                                className="text-muted-foreground"
                            >
                                <Plus aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            onCloseAutoFocus={(event) => event.preventDefault()}
                        >
                            <DropdownMenuItem
                                onSelect={() => startCreate('', false)}
                            >
                                {t('common.new_file')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() => startCreate('', true)}
                            >
                                {t('common.new_folder')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
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
                        floatable
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
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    {paths === null ? (
                        <LoadingRows rows={10} className="px-2" />
                    ) : error !== null ? (
                        <p
                            role="alert"
                            className="px-2 text-sm text-destructive"
                        >
                            {error}
                        </p>
                    ) : tree.length === 0 && creating === null ? (
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
                            actions={treeActions}
                            createIn={
                                creating === null ? null : creating.folder
                            }
                            renderCreateRow={createRow}
                        />
                    )}
                    {/* * The empty area below the rows: a right-click there creates at the project root. */}
                    {isLocal && (
                        <ContextMenu>
                            <ContextMenuTrigger asChild>
                                <div className="min-h-12 flex-1" />
                            </ContextMenuTrigger>
                            <ContextMenuContent
                                className="w-56"
                                onCloseAutoFocus={(event) =>
                                    event.preventDefault()
                                }
                            >
                                <ContextMenuItem
                                    onSelect={() => startCreate('', false)}
                                >
                                    {t('common.new_file')}
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onSelect={() => startCreate('', true)}
                                >
                                    {t('common.new_folder')}
                                </ContextMenuItem>
                            </ContextMenuContent>
                        </ContextMenu>
                    )}
                </div>
            </nav>
        </aside>
    );
}
