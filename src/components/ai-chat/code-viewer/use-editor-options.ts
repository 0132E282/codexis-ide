import { useState } from 'react';

const STORAGE_PREFIX = 'codexis.editor.';

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

export const TAB_SIZES = [2, 4, 8];

const DEFAULTS: EditorOptions = {
    previewTabs: true,
    autoSave: true,
    tabKeyIndents: true,
    wordWrap: true,
    indentGuides: true,
    showWhitespace: false,
    scrollPastEnd: false,
    tabSize: 4,
};

function readOptions(): EditorOptions {
    const options = { ...DEFAULTS };

    for (const name of Object.keys(DEFAULTS) as (keyof EditorOptions)[]) {
        try {
            const stored = window.localStorage.getItem(STORAGE_PREFIX + name);

            if (stored === null) {
                continue;
            }
            if (name === 'tabSize') {
                const size = Number(stored);

                if (TAB_SIZES.includes(size)) {
                    options.tabSize = size;
                }
            } else {
                options[name] = stored === 'true';
            }
        } catch {
            // * Storage is blocked: the default holds.
        }
    }

    return options;
}

/** * The editor preferences of the options menu, each remembered in localStorage under `codexis.editor.<name>`. */
export function useEditorOptions(): {
    options: EditorOptions;
    setOption: <Name extends keyof EditorOptions>(
        name: Name,
        value: EditorOptions[Name],
    ) => void;
} {
    const [options, setOptions] = useState(readOptions);

    const setOption = <Name extends keyof EditorOptions>(
        name: Name,
        value: EditorOptions[Name],
    ) => {
        setOptions((current) => ({ ...current, [name]: value }));
        try {
            window.localStorage.setItem(STORAGE_PREFIX + name, String(value));
        } catch {
            // * Storage is blocked: the choice holds until the page closes.
        }
    };

    return { options, setOption };
}
