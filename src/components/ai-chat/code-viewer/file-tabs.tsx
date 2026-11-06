import { t } from '@/lib/i18n';
import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { FileIcon } from '@/components/ai-chat/file-icon';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

/** * The tab bar of the open files: drag a tab to move it, right-click for the close menu. */
function FileTabsBar({
    tabs,
    selected,
    previewTab,
    dirtyPaths,
    actions,
    tabsEnd,
    tools,
    onOpen,
    onClose,
    onCloseMany,
    onMove,
    onKeepPreview,
}: {
    tabs: string[];
    selected: string;
    /** * The italic tab the next opened file replaces (null: none). */
    previewTab: string | null;
    /** * Tabs with an unsaved edit (get a dot). */
    dirtyPaths: Set<string>;
    actions: FileActions;
    /** Buttons pinned to the right end of the tab bar. */
    tabsEnd?: ReactNode;
    /** Buttons of the open file (view switch, AI edit, ask the AI), just before `tabsEnd`. */
    tools?: ReactNode;
    onOpen: (path: string) => void;
    onClose: (path: string) => void;
    onCloseMany: (paths: string[]) => void;
    onMove: (from: string, to: string) => void;
    /** * Double click on the preview tab: it stays. */
    onKeepPreview: () => void;
}) {
    // * A tab being dragged and the tab it would land on: dropping moves it to that position.
    const [draggedTab, setDraggedTab] = useState<string | null>(null);
    const [dropTab, setDropTab] = useState<string | null>(null);

    return (
        <div
            role="tablist"
            aria-label={t('file_tabs.open_files')}
            className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
        >
            {tabs.map((path) => {
                const name = path.split('/').pop() ?? path;
                const active = path === selected;

                return (
                    <ContextMenu key={path}>
                        <ContextMenuTrigger asChild>
                            <div
                                draggable
                                onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move';
                                    setDraggedTab(path);
                                }}
                                onDragOver={(event) => {
                                    if (draggedTab === null) {
                                        return;
                                    }

                                    event.preventDefault();
                                    setDropTab(path);
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();

                                    if (
                                        draggedTab !== null &&
                                        draggedTab !== path
                                    ) {
                                        onMove(draggedTab, path);
                                    }
                                }}
                                onDragEnd={() => {
                                    setDraggedTab(null);
                                    setDropTab(null);
                                }}
                                className={cn(
                                    draggedTab === path && 'opacity-50',
                                    dropTab === path &&
                                        draggedTab !== path &&
                                        'ring-2 ring-ring',
                                    'group flex h-8 max-w-48 shrink-0 items-center gap-1.5 rounded-lg pr-1 pl-2 text-sm transition-colors duration-150 motion-reduce:transition-none',
                                    active
                                        ? 'bg-muted text-foreground'
                                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                                )}
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    title={path}
                                    onClick={() =>
                                        active ? undefined : onOpen(path)
                                    }
                                    onDoubleClick={() =>
                                        path === previewTab
                                            ? onKeepPreview()
                                            : undefined
                                    }
                                    className="flex min-w-0 items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <FileIcon
                                        name={name}
                                        className="size-4 shrink-0"
                                    />
                                    <span
                                        className={cn(
                                            'truncate',
                                            path === previewTab && 'italic',
                                        )}
                                    >
                                        {name}
                                    </span>
                                    {dirtyPaths.has(path) && (
                                        <span
                                            role="img"
                                            aria-label={t('file_tabs.unsaved')}
                                            className="size-1.5 shrink-0 rounded-full bg-foreground/60"
                                        />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    aria-label={t('file_tabs.close_name', {
                                        name,
                                    })}
                                    onClick={() => onClose(path)}
                                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <X
                                        aria-hidden="true"
                                        className="size-3.5"
                                    />
                                </button>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-60">
                            <ContextMenuItem onSelect={() => onClose(path)}>
                                {t('common.close')}
                            </ContextMenuItem>
                            <ContextMenuItem
                                disabled={tabs.length < 2}
                                onSelect={() =>
                                    onCloseMany(
                                        tabs.filter((item) => item !== path),
                                    )
                                }
                            >
                                {t('file_tabs.close_other_tabs')}
                            </ContextMenuItem>
                            <ContextMenuItem
                                disabled={
                                    tabs.indexOf(path) === tabs.length - 1
                                }
                                onSelect={() =>
                                    onCloseMany(
                                        tabs.slice(tabs.indexOf(path) + 1),
                                    )
                                }
                            >
                                {t('file_tabs.close_tabs_to_the')}
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => onCloseMany(tabs)}>
                                {t('file_tabs.close_all')}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                                onSelect={() => actions.copy(path)}
                            >
                                {t('common.copy_path')}
                            </ContextMenuItem>
                            <ContextMenuItem
                                onSelect={() => actions.copyName(path)}
                            >
                                {t('common.copy_file_name')}
                            </ContextMenuItem>
                            {actions.rename !== undefined && (
                                <ContextMenuItem
                                    onSelect={() => actions.rename?.(path)}
                                >
                                    {t('common.rename')}
                                </ContextMenuItem>
                            )}
                            <ContextMenuItem
                                disabled={actions.ask === undefined}
                                onSelect={() => actions.ask?.(path)}
                            >
                                {t('common.add_file_to_chat')}
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                );
            })}
            {(tools !== undefined || tabsEnd !== undefined) && (
                <div className="sticky right-0 ml-auto flex shrink-0 items-center gap-1 bg-background pl-1">
                    {tools}
                    {tabsEnd}
                </div>
            )}
        </div>
    );
}

export const FileTabs = memo(FileTabsBar);
