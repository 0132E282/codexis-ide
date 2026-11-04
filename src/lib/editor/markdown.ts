import type { MarkdownStorage } from 'tiptap-markdown';
import { Markdown } from 'tiptap-markdown';

declare module '@tiptap/core' {
    interface Storage {
        markdown: MarkdownStorage;
    }
}

/** * `html: true` lets raw HTML pass through so the HTML and Markdown source views share `setContent`. */
export const MarkdownExtension = Markdown.configure({
    html: true,
    linkify: true,
});

export function getSource(
    editor: { getHTML(): string; storage: { markdown: MarkdownStorage } },
    format: 'html' | 'markdown',
): string {
    return format === 'markdown'
        ? editor.storage.markdown.getMarkdown()
        : editor.getHTML();
}
