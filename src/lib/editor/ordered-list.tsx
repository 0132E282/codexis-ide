import OrderedList from '@tiptap/extension-ordered-list';
import type { Editor } from '@tiptap/react';
import { ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LIST_STYLES = [
    { value: 'decimal', label: '1, 2, 3...' },
    { value: 'lower-alpha', label: 'a, b, c...' },
    { value: 'upper-alpha', label: 'A, B, C...' },
    { value: 'lower-roman', label: 'i, ii, iii...' },
    { value: 'upper-roman', label: 'I, II, III...' },
];

/** * Replaces StarterKit's OrderedList to add a per-list `listStyleType` (decimal/roman/alpha). */
export const OrderedListExtended = OrderedList.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            listStyleType: {
                default: null,
                parseHTML: (element) => element.style.listStyleType || null,
                renderHTML: (attributes) =>
                    attributes.listStyleType
                        ? {
                              style: `list-style-type: ${attributes.listStyleType}`,
                          }
                        : {},
            },
        };
    },
});

export function OrderedListToolbar({ editor }: { editor: Editor }) {
    const setStyle = (listStyleType: string) => {
        if (!editor.isActive('orderedList')) {
            editor.chain().focus().toggleOrderedList().run();
        }

        editor
            .chain()
            .focus()
            .updateAttributes('orderedList', { listStyleType })
            .run();
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant={
                        editor.isActive('orderedList') ? 'secondary' : 'ghost'
                    }
                    size="sm"
                    className="h-8 min-w-8 px-1.5"
                    title="Danh sách có thứ tự"
                >
                    <ListOrdered className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                {LIST_STYLES.map(({ value, label }) => (
                    <DropdownMenuItem
                        key={value}
                        onClick={() => setStyle(value)}
                    >
                        {label}
                    </DropdownMenuItem>
                ))}
                {editor.isActive('orderedList') && (
                    <DropdownMenuItem
                        onClick={() =>
                            editor.chain().focus().toggleOrderedList().run()
                        }
                    >
                        Bỏ danh sách
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
