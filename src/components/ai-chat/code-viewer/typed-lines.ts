/**
 * The text while the AI "types" an edit: the untouched head and tail stay as they are, and inside the changed block the new lines replace the old ones one by one (so no file-long red block flashes).
 */
export function typedLines(
    before: string,
    after: string,
    shown: number,
): string {
    const old = before.split('\n');
    const next = after.split('\n');
    let head = 0;

    while (
        head < old.length &&
        head < next.length &&
        old[head] === next[head]
    ) {
        head++;
    }

    let tail = 0;

    while (
        tail < old.length - head &&
        tail < next.length - head &&
        old[old.length - 1 - tail] === next[next.length - 1 - tail]
    ) {
        tail++;
    }

    const typed = Math.max(0, shown - head);

    return [
        ...next.slice(0, head),
        ...next.slice(head, head + typed),
        ...old.slice(head + typed, old.length - tail),
        ...next.slice(next.length - tail),
    ].join('\n');
}
