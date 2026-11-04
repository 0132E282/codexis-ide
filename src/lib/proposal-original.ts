const DIFF_LINE = /^[ +-] /;

/** * Index of `needle` as a run of consecutive lines in `lines`, searching from `from`; -1 when absent. */
function findRun(lines: string[], needle: string[], from: number): number {
    if (needle.length === 0) {
        return from;
    }

    for (let start = from; start <= lines.length - needle.length; start++) {
        if (needle.every((line, offset) => lines[start + offset] === line)) {
            return start;
        }
    }

    return -1;
}

/**
 * The file as it was before an applied AI edit: `modified` is the file now and `diff` the stored change (`+ new`, `- old`, `  same` lines; `…` between far-apart changes, no line numbers).
 * Each changed block is found again in `modified` by its new lines and swapped for its old ones; the lines in between are untouched. Returns null when the diff cannot be matched (the file changed since).
 */
export function reconstructOriginal(
    modified: string,
    diff: string,
): string | null {
    const groups: string[][] = [[]];

    for (const line of diff.split('\n')) {
        if (line === '…') {
            groups.push([]);

            continue;
        }

        if (!DIFF_LINE.test(line)) {
            return null;
        }

        groups[groups.length - 1].push(line);
    }

    const file = modified.replace(/\r\n/g, '\n').split('\n');
    const original: string[] = [];
    let cursor = 0;

    for (const group of groups.filter((rows) => rows.length > 0)) {
        const after = group
            .filter((line) => line[0] !== '-')
            .map((line) => line.slice(2));
        const before = group
            .filter((line) => line[0] !== '+')
            .map((line) => line.slice(2));
        const at = findRun(file, after, cursor);

        if (at === -1) {
            return null;
        }

        original.push(...file.slice(cursor, at), ...before);
        cursor = at + after.length;
    }

    original.push(...file.slice(cursor));

    return original.join('\n');
}

/** * The 1-based line and the number of lines of the first block of lines an applied edit added, in the file now; null when the diff cannot be found in it (the file changed since). */
export function firstChangedLine(
    content: string,
    diff: string,
): { line: number; count: number } | null {
    const block: string[] = [];

    for (const line of diff.split('\n')) {
        if (line === '…') {
            break;
        }

        if (!DIFF_LINE.test(line)) {
            return null;
        }

        if (line[0] !== '-') {
            block.push(line);
        }
    }

    const added = block.findIndex((line) => line[0] === '+');
    const start = findRun(
        content.split('\n'),
        block.map((line) => line.slice(2)),
        0,
    );

    if (added === -1 || start === -1) {
        return null;
    }

    // * The run of added lines that starts there is what gets highlighted.
    let count = 0;

    while (block[added + count]?.[0] === '+') {
        count++;
    }

    return { line: start + added + 1, count };
}
