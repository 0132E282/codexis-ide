import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { LinkEditForm } from './link-edit-form';

// ! Module-level constants: BubbleMenu re-registers its plugin when these change by reference,
// ! which looped infinitely with RichTextEditor's re-render on every transaction.
const shouldShow = ({ editor }: { editor: Editor }) => editor.isActive('link');
// * `flip`/`shift` keep the popup on screen; appending to body escapes nested overflow/transform ancestors.
const options = {
    strategy: 'fixed' as const,
    placement: 'bottom-end' as const,
    offset: 8,
    flip: true,
    shift: true,
    appendTo: () => document.body,
};
const noop = () => {};

/** * Auto-shown link editor while the cursor is inside a link (same form as LinkPopover). */
export function LinkBubbleMenu({ editor }: { editor: Editor }) {
    return (
        <BubbleMenu
            editor={editor}
            pluginKey="linkBubbleMenu"
            shouldShow={shouldShow}
            options={options}
            className="bg-popover text-popover-foreground w-72 rounded-md border p-3 shadow-md"
        >
            <LinkEditForm editor={editor} onDone={noop} />
        </BubbleMenu>
    );
}
