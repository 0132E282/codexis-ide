import { TableKit } from '@tiptap/extension-table';
import type { Editor } from '@tiptap/react';
import {
    Columns3,
    Merge,
    Rows3,
    Split,
    Table as TableIcon,
    Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableSizePicker } from '@/components/ui/table-size-picker';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** * `resizable: true` lets columns be dragged. */
export const TableExtension = TableKit.configure({
    table: { resizable: true },
});

export function TableToolbar({ editor }: { editor: Editor }) {
    const isActive = editor.isActive('table');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                        'h-8 min-w-8 px-1.5',
                        isActive &&
                            'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
                    )}
                    title={t('table.table')}
                >
                    <TableIcon className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                {!editor.isActive('table') && (
                    <TableSizePicker
                        onPick={(rows, cols) =>
                            editor
                                .chain()
                                .focus()
                                .insertTable({
                                    rows,
                                    cols,
                                    withHeaderRow: true,
                                })
                                .run()
                        }
                    />
                )}
                {editor.isActive('table') && (
                    <>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().addRowAfter().run()
                            }
                        >
                            <Rows3 className="size-3.5" />
                            {t('table.add_row')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().addColumnAfter().run()
                            }
                        >
                            <Columns3 className="size-3.5" />
                            {t('table.add_column')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().deleteRow().run()
                            }
                        >
                            <Rows3 className="size-3.5" />
                            {t('table.delete_row')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().deleteColumn().run()
                            }
                        >
                            <Columns3 className="size-3.5" />
                            {t('table.delete_column')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!editor.can().mergeCells()}
                            onClick={() =>
                                editor.chain().focus().mergeCells().run()
                            }
                        >
                            <Merge className="size-3.5" />
                            {t('table.merge_cells')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!editor.can().splitCell()}
                            onClick={() =>
                                editor.chain().focus().splitCell().run()
                            }
                        >
                            <Split className="size-3.5" />
                            {t('table.split_cell')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().toggleHeaderRow().run()
                            }
                        >
                            <Rows3 className="size-3.5" />
                            {t('table.toggle_header_row')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                                editor.chain().focus().deleteTable().run()
                            }
                        >
                            <Trash2 className="size-3.5" />
                            {t('table.delete_table')}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
