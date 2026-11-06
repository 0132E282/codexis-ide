import type { ReactNode } from 'react';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { t } from '@/lib/i18n';

/** * What a file row can do from its right-click menu: copy its path (pasted into the chat it becomes a file tag) or add it to the chat. */
export type FileActions = {
    copy: (path: string) => void;
    /** * Copies just the name of the file or folder. */
    copyName: (path: string) => void;
    /** * Missing where nothing can be renamed (a GitHub repo); only files are renamed. */
    rename?: (path: string) => void;
    /** * Missing when the chat cannot take a file reference. */
    ask?: (path: string) => void;
};

/** * Right-click menu of a file (or folder) row: `items` first (open, show the change...), then the shared copy / add-to-chat entries. */
export function FileContextMenu({
    path,
    actions,
    items,
    folder = false,
    children,
}: {
    path: string;
    actions: FileActions;
    items?: { label: string; onSelect: () => void; disabled?: boolean }[];
    /** * A folder cannot be added to the chat as a file. */
    folder?: boolean;
    children: ReactNode;
}) {
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {items?.map((item) => (
                    <ContextMenuItem
                        key={item.label}
                        disabled={item.disabled}
                        onSelect={item.onSelect}
                    >
                        {item.label}
                    </ContextMenuItem>
                ))}
                {items !== undefined && items.length > 0 && (
                    <ContextMenuSeparator />
                )}
                <ContextMenuItem onSelect={() => actions.copy(path)}>
                    {t('common.copy_path')}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => actions.copyName(path)}>
                    {folder
                        ? t('file_context_menu.copy_name')
                        : t('common.copy_file_name')}
                </ContextMenuItem>
                {!folder && actions.rename !== undefined && (
                    <ContextMenuItem onSelect={() => actions.rename?.(path)}>
                        {t('common.rename')}
                    </ContextMenuItem>
                )}
                {!folder && (
                    <ContextMenuItem
                        disabled={actions.ask === undefined}
                        onSelect={() => actions.ask?.(path)}
                    >
                        {t('common.add_file_to_chat')}
                    </ContextMenuItem>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
