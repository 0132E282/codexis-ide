import type { Editor } from '@tiptap/react';
import { Code2 } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';

/** * Node comes from StarterKit. */
export function CodeBlockToolbar({ editor }: { editor: Editor }) {
    return (
        <Toggle
            size="sm"
            pressed={editor.isActive('codeBlock')}
            onPressedChange={() =>
                editor.chain().focus().toggleCodeBlock().run()
            }
            title="Khối code"
        >
            <Code2 className="size-3.5" />
        </Toggle>
    );
}
