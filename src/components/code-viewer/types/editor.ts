import type { CursorStatus } from '@/components/code-viewer/components/cursor-position';

/** * Where the caret is, outside React state: the editor writes it on every move and only the small label below re-renders, never the viewer. */
export type CursorStore = {
    get: () => CursorStatus | null;
    set: (status: CursorStatus | null) => void;
    subscribe: (listener: () => void) => () => void;
};

export type EditorOptions = {
    /** * A file opened by a click is a preview tab the next file replaces. */
    previewTabs: boolean;
    /** * An edit is written shortly after typing stops. */
    autoSave: boolean;
    /** * Tab types an indent (off: Tab moves the focus out of the editor). */
    tabKeyIndents: boolean;
    wordWrap: boolean;
    indentGuides: boolean;
    showWhitespace: boolean;
    scrollPastEnd: boolean;
    tabSize: number;
};
