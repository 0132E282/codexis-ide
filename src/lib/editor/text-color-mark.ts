import { FontSize } from './font-size';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        textColor: {
            setColor: (color: string) => ReturnType;
            unsetColor: () => ReturnType;
        };
    }
}

/** * ! Chained onto FontSize: a second `TextStyle.extend()` would override it (extensions are matched by name). */
export const TextStyleExtended = FontSize.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            color: {
                default: null,
                parseHTML: (element) => element.style.color || null,
                renderHTML: (attributes) =>
                    attributes.color
                        ? { style: `color: ${attributes.color}` }
                        : {},
            },
        };
    },

    addCommands() {
        return {
            ...this.parent?.(),
            setColor:
                (color: string) =>
                ({ chain }) =>
                    chain().setMark(this.name, { color }).run(),
            unsetColor:
                () =>
                ({ chain }) =>
                    chain().setMark(this.name, { color: null }).run(),
        };
    },
});
