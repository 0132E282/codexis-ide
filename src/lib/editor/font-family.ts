import { TextStyleExtended as FontAndColor } from './text-color-mark';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fontFamily: {
            setFontFamily: (fontFamily: string) => ReturnType;
            unsetFontFamily: () => ReturnType;
        };
    }
}

/** * ! Chained onto the font-size + color `textStyle` mark: another `TextStyle.extend()` would override it (matched by name). */
export const TextStyleExtended = FontAndColor.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            fontFamily: {
                default: null,
                parseHTML: (element) => element.style.fontFamily || null,
                renderHTML: (attributes) =>
                    attributes.fontFamily
                        ? { style: `font-family: ${attributes.fontFamily}` }
                        : {},
            },
        };
    },

    addCommands() {
        return {
            ...this.parent?.(),
            setFontFamily:
                (fontFamily: string) =>
                ({ chain }) =>
                    chain().setMark(this.name, { fontFamily }).run(),
            unsetFontFamily:
                () =>
                ({ chain }) =>
                    chain().setMark(this.name, { fontFamily: null }).run(),
        };
    },
});
