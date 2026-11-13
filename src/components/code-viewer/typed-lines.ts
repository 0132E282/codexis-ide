type DiffWindow = {
    before: string;
    after: string;
    old: string[];
    next: string[];
    head: number;
    tail: number;
};

// * The animation asks for the same pair once per step: split and compare them once, not on every step.
let lastWindow: DiffWindow | null = null;

function getDiffWindow(before: string, after: string): DiffWindow {
    if (
        lastWindow !== null &&
        lastWindow.before === before &&
        lastWindow.after === after
    ) {
        return lastWindow;
    }

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

    lastWindow = { before, after, old, next, head, tail };

    return lastWindow;
}

/**
 * The text while the AI "types" an edit: the untouched head and tail stay as they are, and inside the changed block the new lines replace the old ones one by one (so no file-long red block flashes).
 */
export function typedLines(
    before: string,
    after: string,
    shown: number,
): string {
    const { old, next, head, tail } = getDiffWindow(before, after);
    const typed = Math.max(0, shown - head);

    return [
        ...next.slice(0, head),
        ...next.slice(head, head + typed),
        ...old.slice(head + typed, old.length - tail),
        ...next.slice(next.length - tail),
    ].join('\n');
}
