import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import type { GridGroup } from '@/components/shell/sidebar-grid-groups';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatConversation } from '@/lib/ide';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** One conversation of the open project: open, add to or take out of the chat grid, delete, and (for the shown one) the sub-agents of its running turn. Memoized so a change of one conversation does not redraw the others. */
export const SidebarConversationItem = memo(function SidebarConversationItem({
    conversation,
    isCurrent,
    inGrid,
    activeRoot,
    targetGroup,
    maxGrid,
    gridGroups,
    nextGroup,
    onOpenConversation,
    onDeleteConversation,
    onToggleGrid,
}: {
    conversation: ChatConversation;
    isCurrent: boolean;
    inGrid: boolean;
    activeRoot: string | null;
    targetGroup: number;
    maxGrid: number;
    gridGroups: GridGroup[];
    /** Number of a group that does not exist yet. */
    nextGroup: number;
    onOpenConversation: (id: number) => void;
    onDeleteConversation: (id: number) => void;
    onToggleGrid: (root: string, conversation: number, group: number) => void;
}) {
    return (
        <li>
            <div className="group/chat relative">
                <button
                    type="button"
                    aria-current={isCurrent}
                    title={conversation.title}
                    onClick={() => onOpenConversation(conversation.id)}
                    className={cn(
                        'flex w-full items-center rounded-sm py-1.5 pr-14 pl-2.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        isCurrent && 'bg-accent/60 text-foreground',
                    )}
                >
                    <span className="truncate">
                        {conversation.title || t('sidebar.conversation')}
                    </span>
                </button>
                {inGrid ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t('sidebar.remove_from_grid')}
                        title={t('sidebar.remove_from_grid')}
                        aria-pressed
                        onClick={() => {
                            if (activeRoot !== null) {
                                onToggleGrid(
                                    activeRoot,
                                    conversation.id,
                                    targetGroup,
                                );
                            }
                        }}
                        className="absolute top-1/2 right-7 -translate-y-1/2 text-foreground opacity-100"
                    >
                        <LayoutGrid aria-hidden="true" />
                    </Button>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t('sidebar.add_to_grid')}
                                title={t('sidebar.add_to_grid')}
                                disabled={activeRoot === null}
                                className="absolute top-1/2 right-7 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within/chat:opacity-100 group-hover/chat:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                            >
                                <LayoutGrid aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {gridGroups.map((entry, index) => (
                                <DropdownMenuItem
                                    key={entry.group}
                                    disabled={entry.count >= maxGrid}
                                    onSelect={() => {
                                        if (activeRoot !== null) {
                                            onToggleGrid(
                                                activeRoot,
                                                conversation.id,
                                                entry.group,
                                            );
                                        }
                                    }}
                                >
                                    <span className="flex-1">
                                        {t('sidebar.group_section')} {index + 1}
                                    </span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                        {entry.count}/{maxGrid}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem
                                onSelect={() => {
                                    if (activeRoot !== null) {
                                        onToggleGrid(
                                            activeRoot,
                                            conversation.id,
                                            nextGroup,
                                        );
                                    }
                                }}
                            >
                                <Plus aria-hidden="true" />
                                {t('sidebar.new_group')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('sidebar.delete_conversation')}
                    title={t('sidebar.delete_conversation')}
                    onClick={() => onDeleteConversation(conversation.id)}
                    className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within/chat:opacity-100 group-hover/chat:opacity-100 hover:text-destructive focus-visible:opacity-100"
                >
                    <Trash2 aria-hidden="true" />
                </Button>
            </div>
        </li>
    );
});
