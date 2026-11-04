export type LineChanges = {
    /** * Lines (1-based, in the new text) that did not exist before. */
    added: number[];
    /** * Lines that replace other lines. */
    modified: number[];
    /** * Lines (1-based, in the new text) right above which lines were removed. */
    deleted: number[];
    /** * The same changes as blocks: where each sits in the new text and the old lines it replaced. */
    hunks: Hunk[];
};

export type Hunk = {
    /** * Lines of the new text before the block (0-based index of its first new line). */
    start: number;
    /** * New lines in the block (0 for a block that only removed lines). */
    count: number;
    /** * The old lines the block replaced. */
    old: string[];
};

// * Largest block (old lines × new lines) that gets an exact line match; a bigger block counts as one replaced block.
const MAX_CELLS = 4_000_000;

/** * Line-based difference of two texts, for the editor's change marks: common top and bottom lines are skipped, the middle is matched by longest common subsequence. */
export function lineChanges(before: string, after: string): LineChanges {
    const a = before === '' ? [] : before.split('\n');
    const b = after === '' ? [] : after.split('\n');
    const result: LineChanges = {
        added: [],
        modified: [],
        deleted: [],
        hunks: [],
    };
    let top = 0;

    while (top < a.length && top < b.length && a[top] === b[top]) {
        top++;
    }

    let bottom = 0;

    while (
        bottom < a.length - top &&
        bottom < b.length - top &&
        a[a.length - 1 - bottom] === b[b.length - 1 - bottom]
    ) {
        bottom++;
    }

    const oldLines = a.slice(top, a.length - bottom);
    const newLines = b.slice(top, b.length - bottom);

    const mark = (removedLines: string[], start: number, count: number) => {
        const removed = removedLines.length;

        result.hunks.push({ start, count, old: removedLines });

        if (count === 0 && removed > 0) {
            result.deleted.push(Math.min(start + 1, b.length));
        }

        for (let line = start + 1; line <= start + count; line++) {
            (removed === 0 ? result.added : result.modified).push(line);
        }
    };

    if (oldLines.length * newLines.length > MAX_CELLS) {
        mark(oldLines, top, newLines.length);

        return result;
    }

    // * lcs[i][j]: common lines of the old lines from i and the new lines from j.
    const width = newLines.length + 1;
    const lcs = new Uint32Array((oldLines.length + 1) * width);

    for (let i = oldLines.length - 1; i >= 0; i--) {
        for (let j = newLines.length - 1; j >= 0; j--) {
            lcs[i * width + j] =
                oldLines[i] === newLines[j]
                    ? lcs[(i + 1) * width + j + 1] + 1
                    : Math.max(
                          lcs[(i + 1) * width + j],
                          lcs[i * width + j + 1],
                      );
        }
    }

    let i = 0;
    let j = 0;
    let removed = 0;
    let added = 0;
    let start = top;
    let oldFrom = 0;

    const flush = () => {
        if (removed > 0 || added > 0) {
            mark(oldLines.slice(oldFrom, oldFrom + removed), start, added);
        }

        removed = 0;
        added = 0;
    };

    while (i < oldLines.length || j < newLines.length) {
        if (
            i < oldLines.length &&
            j < newLines.length &&
            oldLines[i] === newLines[j]
        ) {
            flush();
            i++;
            j++;
            start = top + j;
            oldFrom = i;
        } else if (
            j < newLines.length &&
            (i === oldLines.length ||
                lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])
        ) {
            added++;
            j++;
        } else {
            removed++;
            i++;
        }
    }

    flush();

    return result;
}
