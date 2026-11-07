/** * The four code color schemes; each name is what the settings keep and what `monacoTheme()` maps to a Monaco theme. */
export type CodeScheme =
    'light' | 'dark' | 'light-colorblind' | 'dark-colorblind';

export type CodePalette = {
    base: 'vs' | 'vs-dark';
    comment: string;
    keyword: string;
    string: string;
    number: string;
    type: string;
    tag: string;
    attribute: string;
    variable: string;
    delimiter: string;
    lineNumber: string;
    activeLineNumber: string;
};

// * Light+/Dark+ of VS Code (comments green); the colorblind schemes use the Okabe-Ito palette and gray comments, never a red/green pair.
export const CODE_PALETTES: Record<CodeScheme, CodePalette> = {
    light: {
        base: 'vs',
        comment: '#008000',
        keyword: '#0000ff',
        string: '#a31515',
        number: '#098658',
        type: '#267f99',
        tag: '#800000',
        attribute: '#e50000',
        variable: '#001080',
        delimiter: '#000000',
        lineNumber: '#8c959f',
        activeLineNumber: '#57606a',
    },
    dark: {
        base: 'vs-dark',
        comment: '#6a9955',
        keyword: '#569cd6',
        string: '#ce9178',
        number: '#b5cea8',
        type: '#4ec9b0',
        tag: '#569cd6',
        attribute: '#9cdcfe',
        variable: '#9cdcfe',
        delimiter: '#d4d4d4',
        lineNumber: '#6e7681',
        activeLineNumber: '#c9d1d9',
    },
    'light-colorblind': {
        base: 'vs',
        comment: '#6e7781',
        keyword: '#0072b2',
        string: '#b45309',
        number: '#8e4585',
        type: '#007a8c',
        tag: '#0072b2',
        attribute: '#b45309',
        variable: '#1f3a5f',
        delimiter: '#000000',
        lineNumber: '#8c959f',
        activeLineNumber: '#57606a',
    },
    'dark-colorblind': {
        base: 'vs-dark',
        comment: '#8b949e',
        keyword: '#56b4e9',
        string: '#e69f00',
        number: '#cc79a7',
        type: '#66d9e8',
        tag: '#56b4e9',
        attribute: '#f0e442',
        variable: '#cfe3f5',
        delimiter: '#d4d4d4',
        lineNumber: '#6e7681',
        activeLineNumber: '#c9d1d9',
    },
};
