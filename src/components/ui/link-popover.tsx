import type { Editor } from '@tiptap/react';
import { Link as LinkIcon } from 'lucide-react';
import { useState } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Toggle } from '@/components/ui/toggle';
import { LinkEditForm } from './link-edit-form';

/** * Insert only: disabled inside an existing link, which LinkBubbleMenu edits. */
export function LinkPopover({ editor }: { editor: Editor }) {
    const [open, setOpen] = useState(false);
    const onExistingLink = editor.isActive('link');
    const disabled = editor.state.selection.empty || onExistingLink;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Toggle
                    size="sm"
                    pressed={onExistingLink}
                    disabled={disabled}
                    title={
                        onExistingLink
                            ? 'Nhấp vào liên kết để sửa'
                            : disabled
                              ? 'Bôi đen văn bản trước để gắn liên kết'
                              : 'Chèn liên kết'
                    }
                >
                    <LinkIcon className="size-3.5" />
                </Toggle>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
                {open && (
                    <LinkEditForm
                        editor={editor}
                        onDone={() => setOpen(false)}
                    />
                )}
            </PopoverContent>
        </Popover>
    );
}
