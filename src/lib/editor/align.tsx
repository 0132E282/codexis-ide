import TextAlignExtension from '@tiptap/extension-text-align';
import type { Editor } from '@tiptap/react';
import { AlignLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ALIGN_OPTIONS } from './constants';

export const TextAlign = TextAlignExtension.configure({
    types: ['heading', 'paragraph'],
});

export function AlignToolbar({ editor }: { editor: Editor }) {
    const active = ALIGN_OPTIONS.find((option) =>
        editor.isActive({ textAlign: option.value }),
    );
    // * Left is the browser default, so only other alignments show as active.
    const isNonDefault = !!active && active.value !== 'left';
    const ActiveIcon = active?.icon ?? AlignLeft;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                        'h-8 min-w-8 px-1.5',
                        isNonDefault &&
                            'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
                    )}
                >
                    <ActiveIcon className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                {ALIGN_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuItem
                        key={value}
                        onClick={() =>
                            editor.chain().focus().setTextAlign(value).run()
                        }
                    >
                        <Icon className="size-3.5" />
                        {label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
