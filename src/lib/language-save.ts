type SavedHandler = (root: string, path: string, text: string) => void;

const handlers = new Set<SavedHandler>();

/** Tells the language bridge (loaded with the editor) that a file was saved, without the file session importing Monaco. */
export function notifyDocumentSaved(root: string, path: string, text: string) {
    handlers.forEach((handler) => handler(root, path, text));
}

export function onDocumentSaved(handler: SavedHandler) {
    handlers.add(handler);

    return () => {
        handlers.delete(handler);
    };
}
