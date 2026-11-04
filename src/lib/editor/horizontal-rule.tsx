import type { Editor } from '@tiptap/react';
import { Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** * Node comes from StarterKit. */
export function HorizontalRuleToolbar({ editor }: { editor: Editor }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 min-w-8 px-1.5"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Đường kẻ ngang"
        >
            <Minus className="size-3.5" />
        </Button>
    );
}
