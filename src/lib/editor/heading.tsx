import type { Editor } from '@tiptap/react';
import { HEADING_LEVELS } from './constants';
import { t } from '@/lib/i18n';

/** * Node comes from StarterKit. */
export function HeadingToolbar({ editor }: { editor: Editor }) {
    const activeLevel =
        HEADING_LEVELS.find((level) => editor.isActive('heading', { level })) ??
        0;

    return (
        <select
            value={activeLevel}
            onChange={(event) => {
                const level = Number(event.target.value) as
                    (typeof HEADING_LEVELS)[number] | 0;

                if (level === 0) {
                    editor.chain().focus().setParagraph().run();
                } else {
                    editor.chain().focus().toggleHeading({ level }).run();
                }
            }}
            className="h-8 rounded-md border border-input bg-transparent px-1.5 text-sm"
        >
            <option value={0}>{t('heading.paragraph')}</option>
            {HEADING_LEVELS.map((level) => (
                <option key={level} value={level}>
                    {t('heading.heading_level', { level })}
                </option>
            ))}
        </select>
    );
}
