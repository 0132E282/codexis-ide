import type { Editor } from '@tiptap/react';
import { Quote } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';

/** * Node comes from StarterKit. */
export function BlockquoteToolbar({ editor }: { editor: Editor }) {
    return (
        <Toggle
            size="sm"
            pressed={editor.isActive('blockquote')}
            onPressedChange={() =>
                editor.chain().focus().toggleBlockquote().run()
            }
            title="Trích dẫn"
        >
            <Quote className="size-3.5" />
        </Toggle>
    );
}
