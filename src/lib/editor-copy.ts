/** The last text copied from the code editor and where it came from, so pasting it into the chat can send a short reference instead of the code. */
let last: { text: string; reference: string } | null = null;

/** Remembers a copy of lines `startLine`–`endLine` (1-based) of `path`. */
export function rememberEditorCopy(
    path: string,
    startLine: number,
    endLine: number,
    text: string,
) {
    last = {
        text,
        reference:
            endLine > startLine
                ? `${path}:${startLine}-${endLine}`
                : `${path}:${startLine}`,
    };
}

/** `path:start-end` when `pasted` is exactly what was last copied from the editor; null for any other text. */
export function referenceForPaste(pasted: string): string | null {
    return last !== null && last.text === pasted ? last.reference : null;
}
