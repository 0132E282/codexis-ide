import type { Editor } from '@tiptap/react';
import { Bold, Italic, List, Strikethrough } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';

/** * Marks come from StarterKit; ordered lists are their own plugin (numbering style). */
export function MarksToolbar({ editor }: { editor: Editor }) {
    return (
        <>
            <Toggle
                size="sm"
                pressed={editor.isActive('bold')}
                onPressedChange={() =>
                    editor.chain().focus().toggleBold().run()
                }
            >
                <Bold className="size-3.5" />
            </Toggle>
            <Toggle
                size="sm"
                pressed={editor.isActive('italic')}
                onPressedChange={() =>
                    editor.chain().focus().toggleItalic().run()
                }
            >
                <Italic className="size-3.5" />
            </Toggle>
            <Toggle
                size="sm"
                pressed={editor.isActive('strike')}
                onPressedChange={() =>
                    editor.chain().focus().toggleStrike().run()
                }
            >
                <Strikethrough className="size-3.5" />
            </Toggle>
            <Toggle
                size="sm"
                pressed={editor.isActive('bulletList')}
                onPressedChange={() =>
                    editor.chain().focus().toggleBulletList().run()
                }
            >
                <List className="size-3.5" />
            </Toggle>
        </>
    );
}
