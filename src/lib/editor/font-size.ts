import { TextStyle } from '@tiptap/extension-text-style';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fontSize: {
            setFontSize: (size: string) => ReturnType;
            unsetFontSize: () => ReturnType;
        };
    }
}

/** * Tiptap has no font-size extension; adds a `fontSize` attribute to `textStyle` as the docs recommend. */
export const FontSize = TextStyle.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            fontSize: {
                default: null,
                parseHTML: (element) => element.style.fontSize || null,
                renderHTML: (attributes) =>
                    attributes.fontSize
                        ? { style: `font-size: ${attributes.fontSize}` }
                        : {},
            },
        };
    },

    addCommands() {
        return {
            ...this.parent?.(),
            setFontSize:
                (size: string) =>
                ({ chain }) =>
                    chain().setMark(this.name, { fontSize: size }).run(),
            unsetFontSize:
                () =>
                ({ chain }) =>
                    chain().setMark(this.name, { fontSize: null }).run(),
        };
    },
});
