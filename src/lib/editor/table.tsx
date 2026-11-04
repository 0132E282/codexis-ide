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
                    title="Bảng"
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
                            Thêm hàng
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().addColumnAfter().run()
                            }
                        >
                            <Columns3 className="size-3.5" />
                            Thêm cột
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().deleteRow().run()
                            }
                        >
                            <Rows3 className="size-3.5" />
                            Xóa hàng
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().deleteColumn().run()
                            }
                        >
                            <Columns3 className="size-3.5" />
                            Xóa cột
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!editor.can().mergeCells()}
                            onClick={() =>
                                editor.chain().focus().mergeCells().run()
                            }
                        >
                            <Merge className="size-3.5" />
                            Gộp ô
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!editor.can().splitCell()}
                            onClick={() =>
                                editor.chain().focus().splitCell().run()
                            }
                        >
                            <Split className="size-3.5" />
                            Tách ô
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                editor.chain().focus().toggleHeaderRow().run()
                            }
                        >
                            <Rows3 className="size-3.5" />
                            Bật/tắt hàng tiêu đề
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                                editor.chain().focus().deleteTable().run()
                            }
                        >
                            <Trash2 className="size-3.5" />
                            Xóa bảng
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
