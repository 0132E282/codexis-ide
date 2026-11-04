import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        callout: {
            setCallout: () => ReturnType;
            unsetCallout: () => ReturnType;
        };
    }
}

/** * Reference Node-type plugin (with HighlightMark), registered per field via `extensions`. */
export const CalloutNode = Node.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    defining: true,

    parseHTML() {
        return [{ tag: 'div[data-callout]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'div',
            mergeAttributes(HTMLAttributes, { 'data-callout': '' }),
            0,
        ];
    },

    addCommands() {
        return {
            setCallout:
                () =>
                ({ commands }) =>
                    commands.wrapIn(this.name),
            unsetCallout:
                () =>
                ({ commands }) =>
                    commands.lift(this.name),
        };
    },
});
