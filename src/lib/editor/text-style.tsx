import type { Editor } from '@tiptap/react';
import { FONT_FAMILIES, FONT_SIZES } from './constants';
import { TextStyleExtended } from './font-family';

export { TextStyleExtended };

/** * Font family and size are attributes chained onto the single `textStyle` mark. */
export function TextStyleToolbar({ editor }: { editor: Editor }) {
    const activeFontFamily =
        (editor.getAttributes('textStyle').fontFamily as string | undefined) ??
        '';
    const activeFontSize =
        (editor.getAttributes('textStyle').fontSize as string | undefined) ??
        '';

    return (
        <>
            <select
                value={activeFontFamily}
                onChange={(event) => {
                    if (event.target.value) {
                        editor
                            .chain()
                            .focus()
                            .setFontFamily(event.target.value)
                            .run();
                    } else {
                        editor.chain().focus().unsetFontFamily().run();
                    }
                }}
                className="h-8 rounded-md border border-input bg-transparent px-1.5 text-sm"
            >
                {FONT_FAMILIES.map(({ label, value }) => (
                    <option key={label} value={value}>
                        {label}
                    </option>
                ))}
            </select>

            <select
                value={activeFontSize}
                onChange={(event) => {
                    if (event.target.value) {
                        editor
                            .chain()
                            .focus()
                            .setFontSize(event.target.value)
                            .run();
                    } else {
                        editor.chain().focus().unsetFontSize().run();
                    }
                }}
                className="h-8 rounded-md border border-input bg-transparent px-1.5 text-sm"
            >
                <option value="">Cỡ chữ</option>
                {FONT_SIZES.map((size) => (
                    <option key={size} value={size}>
                        {size}
                    </option>
                ))}
            </select>
        </>
    );
}
