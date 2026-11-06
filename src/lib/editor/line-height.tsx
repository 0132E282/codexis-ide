import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { LINE_HEIGHTS } from './constants';
import { t } from '@/lib/i18n';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        lineHeight: {
            setLineHeight: (lineHeight: string) => ReturnType;
            unsetLineHeight: () => ReturnType;
        };
    }
}

/** * Block-level style (unitless multiplier), so a global attribute on paragraph/heading instead of the `textStyle` mark. */
export const LineHeight = Extension.create({
    name: 'lineHeight',

    addGlobalAttributes() {
        return [
            {
                types: ['paragraph', 'heading'],
                attributes: {
                    lineHeight: {
                        default: null,
                        parseHTML: (element) =>
                            element.style.lineHeight || null,
                        renderHTML: (attributes) =>
                            attributes.lineHeight
                                ? {
                                      style: `line-height: ${attributes.lineHeight}`,
                                  }
                                : {},
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            setLineHeight:
                (lineHeight: string) =>
                ({ commands }) =>
                    commands.updateAttributes('paragraph', { lineHeight }) &&
                    commands.updateAttributes('heading', { lineHeight }),
            unsetLineHeight:
                () =>
                ({ commands }) =>
                    commands.updateAttributes('paragraph', {
                        lineHeight: null,
                    }) &&
                    commands.updateAttributes('heading', { lineHeight: null }),
        };
    },
});

export function LineHeightToolbar({ editor }: { editor: Editor }) {
    const active = (editor.getAttributes('paragraph').lineHeight ??
        editor.getAttributes('heading').lineHeight ??
        '') as string;

    return (
        <select
            value={active}
            onChange={(event) => {
                if (event.target.value) {
                    editor
                        .chain()
                        .focus()
                        .setLineHeight(event.target.value)
                        .run();
                } else {
                    editor.chain().focus().unsetLineHeight().run();
                }
            }}
            className="h-8 rounded-md border border-input bg-transparent px-1.5 text-sm"
            title={t('line_height.line_spacing')}
        >
            <option value="">{t('line_height.line_spacing')}</option>
            {LINE_HEIGHTS.map((lineHeight) => (
                <option key={lineHeight} value={lineHeight}>
                    {lineHeight}
                </option>
            ))}
        </select>
    );
}
