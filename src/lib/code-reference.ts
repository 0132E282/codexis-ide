/** * A piece of code picked in the code viewer: the chat shows it as a small tag (file and lines) and sends the code with the message. A copied file path is the same thing with no lines (`startLine` 0, `text` = the path): a tag with the file name only. */
export type CodeReference = {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
    /** * Added by itself for the file open in the viewer (replaced when another file opens), not picked by the person. */
    auto?: boolean;
    /** * The mark shown inside the typed text where the person pasted it (`[file.ts:12-20]`); on send the mark is replaced by the reference in place. */
    token?: string;
};

const isWholeFile = (reference: CodeReference) => reference.startLine === 0;

export function referenceLines(reference: CodeReference): string {
    return reference.startLine === reference.endLine
        ? `${reference.startLine}`
        : `${reference.startLine}-${reference.endLine}`;
}

/** * `file.ts:12-20`: what the tag shows. */
export function referenceLabel(reference: CodeReference): string {
    const name = reference.path.split('/').pop() ?? reference.path;

    return isWholeFile(reference)
        ? name
        : `${name}:${referenceLines(reference)}`;
}
