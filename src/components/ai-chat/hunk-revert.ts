import type { editor } from 'monaco-editor';
import type { Hunk } from '@/lib/line-changes';

/** * The edit that puts one changed block back as it is in git HEAD. */
export function revertEdit(
    model: editor.ITextModel,
    hunk: Hunk,
): { range: editor.ISingleEditOperation['range']; text: string } {
    const total = model.getLineCount();
    const end = (line: number) => model.getLineMaxColumn(line);
    const last = hunk.start + hunk.count;
    const oldText = hunk.old.join('\n');
    let range = {
        startLineNumber: hunk.start + 1,
        startColumn: 1,
        endLineNumber: last,
        endColumn: last >= 1 ? end(Math.min(last, total)) : 1,
    };
    let text = oldText;

    if (hunk.count === 0) {
        // * Only lines were removed: put them back where they were.
        if (hunk.start < total) {
            range = {
                startLineNumber: hunk.start + 1,
                startColumn: 1,
                endLineNumber: hunk.start + 1,
                endColumn: 1,
            };
            text = `${oldText}\n`;
        } else {
            range = {
                startLineNumber: total,
                startColumn: end(total),
                endLineNumber: total,
                endColumn: end(total),
            };
            text = `\n${oldText}`;
        }
    } else if (hunk.old.length === 0) {
        // * Only lines were added: take them out with their line break.
        if (last < total) {
            range.endLineNumber = last + 1;
            range.endColumn = 1;
        } else if (hunk.start > 0) {
            range.startLineNumber = hunk.start;
            range.startColumn = end(hunk.start);
        }

        text = '';
    }

    return { range, text };
}
