export type DiffRow =
    | { kind: 'hunk'; text: string }
    | {
          kind: ' ' | '+' | '-';
          oldNo: number | null;
          newNo: number | null;
          text: string;
      };
// * Largest block (old lines × new lines) matched exactly; a bigger block is shown as all removed, then all added.
const MAX_CELLS = 4_000_000;
const CONTEXT = 3;

type Op = { kind: ' ' | '+' | '-'; text: string };

function diffOps(a: string[], b: string[]): Op[] {
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
    const ops: Op[] = a.slice(0, top).map((text) => ({ kind: ' ', text }));

    if (oldLines.length * newLines.length > MAX_CELLS) {
        ops.push(
            ...oldLines.map((text): Op => ({ kind: '-', text })),
            ...newLines.map((text): Op => ({ kind: '+', text })),
        );
    } else {
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

        while (i < oldLines.length || j < newLines.length) {
            if (
                i < oldLines.length &&
                j < newLines.length &&
                oldLines[i] === newLines[j]
            ) {
                ops.push({ kind: ' ', text: oldLines[i] });
                i++;
                j++;
            } else if (
                i < oldLines.length &&
                (j === newLines.length ||
                    lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
            ) {
                ops.push({ kind: '-', text: oldLines[i] });
                i++;
            } else {
                ops.push({ kind: '+', text: newLines[j] });
                j++;
            }
        }
    }

    ops.push(
        ...a.slice(a.length - bottom).map((text): Op => ({ kind: ' ', text })),
    );

    return ops;
}

/** * Rows of a unified diff like `git diff`: each block of changes with 3 lines around it and an "@@ -a,b +c,d @@" header, the rest left out. */
export function unifiedDiff(before: string, after: string): DiffRow[] {
    const ops = diffOps(
        before === '' ? [] : before.split('\n'),
        after === '' ? [] : after.split('\n'),
    );
    // * Old and new line number of every op (the number the op would have on its side).
    const numbered = [];
    let oldNo = 1;
    let newNo = 1;

    for (const op of ops) {
        numbered.push({
            ...op,
            oldNo: op.kind === '+' ? null : oldNo,
            newNo: op.kind === '-' ? null : newNo,
        });

        if (op.kind !== '+') {
            oldNo++;
        }

        if (op.kind !== '-') {
            newNo++;
        }
    }

    const keep = new Array<boolean>(numbered.length).fill(false);

    numbered.forEach((row, index) => {
        if (row.kind !== ' ') {
            for (
                let near = Math.max(0, index - CONTEXT);
                near <= Math.min(numbered.length - 1, index + CONTEXT);
                near++
            ) {
                keep[near] = true;
            }
        }
    });

    const rows: DiffRow[] = [];
    let index = 0;

    while (index < numbered.length) {
        if (!keep[index]) {
            index++;

            continue;
        }

        let end = index;

        while (end < numbered.length && keep[end]) {
            end++;
        }

        const block = numbered.slice(index, end);
        const oldCount = block.filter((row) => row.kind !== '+').length;
        const newCount = block.filter((row) => row.kind !== '-').length;
        const oldStart = block.find((row) => row.oldNo !== null)?.oldNo ?? 0;
        const newStart = block.find((row) => row.newNo !== null)?.newNo ?? 0;

        rows.push({
            kind: 'hunk',
            text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        });
        rows.push(...block);
        index = end;
    }

    return rows;
}
