/** A pasted image or file waiting to be sent with the message. */
export type Attachment = {
    id: string;
    name: string;
    /** Where it was saved: sent to the CLI as `@path`. */
    path: string;
    /** Object URL of an image's thumbnail (null for other files). */
    preview: string | null;
};

const PATH_START = /^\/(Users|Volumes|home|private|tmp|opt|var|Applications)\//;

/** Absolute paths (or `file://` links) pasted as text, one per line; empty unless every line is one. */
export function pastedPaths(text: string): string[] {
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    const paths = lines.map((line) =>
        line.startsWith('file://')
            ? decodeURIComponent(line.slice('file://'.length))
            : line,
    );

    return paths.length > 0 && paths.every((path) => PATH_START.test(path))
        ? paths
        : [];
}

/** The files on the clipboard of a paste event. */
export function pastedFiles(clipboardData: DataTransfer): File[] {
    // * Some webviews list a pasted file only under `items`, not `files`.
    return clipboardData.files.length > 0
        ? Array.from(clipboardData.files)
        : Array.from(clipboardData.items)
              .filter((item) => item.kind === 'file')
              .map((item) => item.getAsFile())
              .filter((file) => file !== null);
}
