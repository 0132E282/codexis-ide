import { t } from '@/lib/i18n';
import { memo } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { FileContextMenu } from '@/components/ai-chat/file-context-menu';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import type { AiChatProposal } from '@/types';
import { cn } from '@/lib/utils';
import { CHANGE_BADGES } from './constants';
import type { TreeNode } from './tree';

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
                                        isDir
                                            ? onToggle(node.path)
                                            : onSelect(node.path),
                                },
                            ]}
                        >
                            <button
                                type="button"
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
                                    node.path === selected &&
                                        'bg-accent text-accent-foreground',
                                    marked.has(node.path) &&
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
                                <FileIcon
                                    name={node.name}
                                    dir={isDir}
                                    open={isOpen}
                                />
                                <span
                                    className={cn(
                                        'truncate',
                                        changed.has(node.path) &&
                                            CHANGE_BADGES[
                                                changed.get(node.path)!
                                            ].className,
                                        // * A folder that holds a changed file is yellow too.
                                        isDir &&
                                            changedDirs.has(node.path) &&
                                            CHANGE_BADGES.update.className,
                                    )}
                                >
                                    {node.name}
                                </span>
                                {isDir && changedDirs.has(node.path) && (
                                    <span
                                        role="img"
                                        aria-label={t(
                                            'tree_items.contains_changed_files',
                                        )}
                                        title={t(
                                            'tree_items.contains_changed_files',
                                        )}
                                        className="ml-auto size-1.5 shrink-0 rounded-full bg-yellow-500"
                                    />
                                )}
                                {changed.has(node.path) && (
                                    <span
                                        title={t('tree_items.changed_kind', {
                                            kind: t(
                                                CHANGE_BADGES[
                                                    changed.get(node.path)!
                                                ].label,
                                            ),
                                        })}
                                        className={cn(
                                            'ml-auto shrink-0 text-xs font-medium',
                                            CHANGE_BADGES[
                                                changed.get(node.path)!
                                            ].className,
                                        )}
                                    >
                                        {
                                            CHANGE_BADGES[
                                                changed.get(node.path)!
                                            ].letter
                                        }
                                    </span>
                                )}
                            </button>
                        </FileContextMenu>
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
