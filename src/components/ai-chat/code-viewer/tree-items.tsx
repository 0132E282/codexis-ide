import { t } from '@/lib/i18n';
import { memo } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { FileContextMenu } from '@/components/ai-chat/file-context-menu';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import type { AiChatProposal } from '@/types';
import { cn } from '@/lib/utils';
import { CHANGE_BADGES, TREE_PATH_MIME } from './constants';
import type { TreeNode } from './tree';

/** One row of the tree. Memoized on primitives, so choosing a file re-renders only the row that lost the selection and the one that got it, not every row (each has a context menu and an icon). */
const TreeRow = memo(function TreeRow({
    node,
    depth,
    isOpen,
    isSelected,
    isMarked,
    change,
    hasChangedFile,
    onToggle,
    onSelect,
    onMark,
    onAttach,
    actions,
}: {
    node: TreeNode;
    depth: number;
    isOpen: boolean;
    isSelected: boolean;
    isMarked: boolean;
    /** How the AI changed this file (undefined: not changed). */
    change: AiChatProposal['action'] | undefined;
    /** A folder that holds a changed file. */
    hasChangedFile: boolean;
    onToggle: (path: string) => void;
    onSelect: (path: string) => void;
    onMark: (path: string) => void;
    onAttach?: (path: string) => void;
    actions: FileActions;
}) {
    const isDir = node.children !== null;

    return (
        <FileContextMenu
            path={node.path}
            actions={actions}
            folder={isDir}
            items={[
                {
                    label: isDir
                        ? isOpen
                            ? t('tree_items.collapse')
                            : t('tree_items.expand')
                        : t('common.open_file'),
                    onSelect: () =>
                        isDir ? onToggle(node.path) : onSelect(node.path),
                },
            ]}
        >
            <button
                type="button"
                data-path={node.path}
                data-folder={isDir ? '' : undefined}
                draggable
                onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData(TREE_PATH_MIME, node.path);
                    event.dataTransfer.setData('text/plain', node.path);
                }}
                onDoubleClick={() =>
                    isDir ? undefined : onAttach?.(node.path)
                }
                onClick={(event) =>
                    isDir
                        ? onToggle(node.path)
                        : event.metaKey || event.ctrlKey
                          ? onMark(node.path)
                          : onSelect(node.path)
                }
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                className={cn(
                    'flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    isSelected && 'bg-accent text-accent-foreground',
                    isMarked &&
                        'bg-primary/15 text-foreground ring-1 ring-primary/40',
                )}
            >
                {isDir ? (
                    isOpen ? (
                        <ChevronDown
                            aria-hidden="true"
                            className="size-3.5 shrink-0"
                        />
                    ) : (
                        <ChevronRight
                            aria-hidden="true"
                            className="size-3.5 shrink-0"
                        />
                    )
                ) : (
                    <span className="size-3.5 shrink-0" />
                )}
                <FileIcon name={node.name} dir={isDir} open={isOpen} />
                <span
                    className={cn(
                        'truncate',
                        change !== undefined && CHANGE_BADGES[change].className,
                        // * A folder that holds a changed file is yellow too.
                        isDir &&
                            hasChangedFile &&
                            CHANGE_BADGES.update.className,
                    )}
                >
                    {node.name}
                </span>
                {isDir && hasChangedFile && (
                    <span
                        role="img"
                        aria-label={t('tree_items.contains_changed_files')}
                        title={t('tree_items.contains_changed_files')}
                        className="ml-auto size-1.5 shrink-0 rounded-full bg-yellow-500"
                    />
                )}
                {change !== undefined && (
                    <span
                        title={t('tree_items.changed_kind', {
                            kind: t(CHANGE_BADGES[change].label),
                        })}
                        className={cn(
                            'ml-auto shrink-0 text-xs font-medium',
                            CHANGE_BADGES[change].className,
                        )}
                    >
                        {CHANGE_BADGES[change].letter}
                    </span>
                )}
            </button>
        </FileContextMenu>
    );
});

function TreeItemsList({
    nodes,
    depth,
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
    parentPath = '',
    createIn = null,
    renderCreateRow,
}: {
    nodes: TreeNode[];
    depth: number;
    openDirs: Set<string>;
    onToggle: (path: string) => void;
    selected: string | null;
    onSelect: (path: string) => void;
    /** * Files picked with Cmd/Ctrl+click (several at once, tagged in the chat). */
    marked: Set<string>;
    onMark: (path: string) => void;
    /** Double click on a file: it is attached to the chat message. */
    onAttach?: (path: string) => void;
    changed: Map<string, AiChatProposal['action']>;
    changedDirs: Set<string>;
    actions: FileActions;
    /** * Folder these rows are the children of (empty: the project root). */
    parentPath?: string;
    /** * Folder where a new entry is being named (null: none): its row is drawn first in that folder. */
    createIn?: string | null;
    renderCreateRow?: (depth: number) => ReactNode;
}) {
    return (
        <ul role={depth === 0 ? 'tree' : 'group'}>
            {createIn === parentPath && renderCreateRow?.(depth)}
            {nodes.map((node) => {
                const isDir = node.children !== null;
                const isOpen = openDirs.has(node.path);

                return (
                    <li
                        key={node.path}
                        role="treeitem"
                        data-path={node.path}
                        aria-expanded={isDir ? isOpen : undefined}
                        aria-selected={
                            node.path === selected || marked.has(node.path)
                        }
                    >
                        <TreeRow
                            node={node}
                            depth={depth}
                            isOpen={isOpen}
                            isSelected={node.path === selected}
                            isMarked={marked.has(node.path)}
                            change={changed.get(node.path)}
                            hasChangedFile={changedDirs.has(node.path)}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            onMark={onMark}
                            onAttach={onAttach}
                            actions={actions}
                        />
                        {isDir && isOpen && node.children && (
                            <TreeItems
                                nodes={node.children}
                                depth={depth + 1}
                                openDirs={openDirs}
                                onToggle={onToggle}
                                selected={selected}
                                onSelect={onSelect}
                                marked={marked}
                                onMark={onMark}
                                onAttach={onAttach}
                                changed={changed}
                                changedDirs={changedDirs}
                                actions={actions}
                                parentPath={node.path}
                                createIn={createIn}
                                renderCreateRow={renderCreateRow}
                            />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/** * Memoized: typing in the editor re-renders the viewer, but the tree rows only change with their own props. */
export const TreeItems = memo(TreeItemsList);
