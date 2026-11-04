export type DiffRowKind = 'file' | 'hunk' | 'add' | 'del' | 'context' | 'note';

export type DiffRow = {
    kind: DiffRowKind;
    /** Text without the leading +/-/space marker (full line for file/hunk/note rows). */
    text: string;
    oldLine?: number;
    newLine?: number;
};

/** Larger diffs fall back to a plain code block. */
export const MAX_DIFF_LINES = 2000;

const FILE_META =
    /^(?:--- |\+\+\+ |index |new file mode|deleted file mode|old mode|new mode|similarity index|rename (?:from|to) |Binary files )/;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses a unified diff in a single pass (O(lines)); a bare list of +/- lines also works. Returns
 * null when the input is not a usable diff (no +/- line, unknown line inside a hunk, too long) so callers can
 * render a plain code block instead.
 */
export function parseDiff(source: string): DiffRow[] | null {
    const lines = source.split(/\r?\n/);

    if (lines.at(-1) === '') {
        lines.pop();
    }

    if (lines.length === 0 || lines.length > MAX_DIFF_LINES) {
        return null;
    }

    const rows: DiffRow[] = [];
    let inBody = false;
    let oldLine = 1;
    let newLine = 1;
    let oldRemaining = Infinity;
    let newRemaining = Infinity;
    let changes = 0;

    for (const line of lines) {
        const hunk = HUNK_HEADER.exec(line);

        if (hunk) {
            inBody = true;
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[3]);
            oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
            newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
            rows.push({ kind: 'hunk', text: line });

            continue;
        }

        // * Counts from the hunk header end the body; until then ---/+++ lines are removed/added text.
        const bodyExpected = inBody && (oldRemaining > 0 || newRemaining > 0);
        const isHeader =
            line.startsWith('diff ') ||
            (!bodyExpected &&
                (line.startsWith('--- ') ||
                    line.startsWith('+++ ') ||
                    FILE_META.test(line)));

        if (isHeader || (!inBody && FILE_META.test(line))) {
            inBody = false;
            rows.push({ kind: 'file', text: line });

            continue;
        }

        if (!inBody) {
            // * No @@ header (short snippets): the first +/-/context line starts an implicit hunk.
            if (!/^[-+ \\]/.test(line) && line !== '') {
                return null;
            }

            inBody = true;
            oldLine = 1;
            newLine = 1;
            oldRemaining = Infinity;
            newRemaining = Infinity;
        }

        const marker = line[0];

        if (marker === '\\') {
            rows.push({ kind: 'note', text: line });
        } else if (marker === '+') {
            rows.push({ kind: 'add', text: line.slice(1), newLine });
            newLine++;
            newRemaining--;
            changes++;
        } else if (marker === '-') {
            rows.push({ kind: 'del', text: line.slice(1), oldLine });
            oldLine++;
            oldRemaining--;
            changes++;
        } else if (marker === ' ' || line === '') {
            rows.push({
                kind: 'context',
                text: line.slice(1),
                oldLine,
                newLine,
            });
            oldLine++;
            newLine++;
            oldRemaining--;
            newRemaining--;
        } else {
            return null;
        }
    }

    return changes > 0 ? rows : null;
}
