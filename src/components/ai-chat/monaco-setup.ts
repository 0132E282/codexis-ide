import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// * Monaco (the editor engine of VS Code) is served from the app's own bundle, not a CDN. Only the base worker is wired:
// * syntax highlighting needs no language worker, and the viewer is read-only.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

// * VS Code's classic Light+/Dark+ token colors (comments green) on a transparent background, so the editor takes the page's own colors.
const COMMON_COLORS = {
    'editor.background': '#00000000',
    'editorGutter.background': '#00000000',
    'editor.lineHighlightBackground': '#00000000',
    'editor.lineHighlightBorder': '#00000000',
    'scrollbarSlider.background': '#8b949e33',
    'scrollbarSlider.hoverBackground': '#8b949e55',
    'scrollbarSlider.activeBackground': '#8b949e77',
    'editorIndentGuide.background1': '#8b949e22',
    'editorIndentGuide.activeBackground1': '#8b949e55',
};

monaco.editor.defineTheme('pm-light', {
    base: 'vs',
    inherit: true,
    rules: [
        { token: 'comment', foreground: '008000' },
        { token: 'keyword', foreground: '0000ff' },
        { token: 'metatag', foreground: '0000ff' },
        { token: 'string', foreground: 'a31515' },
        { token: 'number', foreground: '098658' },
        { token: 'type', foreground: '267f99' },
        { token: 'tag', foreground: '800000' },
        { token: 'attribute.name', foreground: 'e50000' },
        { token: 'variable', foreground: '001080' },
        { token: 'delimiter', foreground: '000000' },
    ],
    colors: {
        ...COMMON_COLORS,
        'editorLineNumber.foreground': '#8c959f',
        'editorLineNumber.activeForeground': '#57606a',
    },
});

monaco.editor.defineTheme('pm-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: 'comment', foreground: '6a9955' },
        { token: 'keyword', foreground: '569cd6' },
        { token: 'metatag', foreground: '569cd6' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'type', foreground: '4ec9b0' },
        { token: 'tag', foreground: '569cd6' },
        { token: 'attribute.name', foreground: '9cdcfe' },
        { token: 'variable', foreground: '9cdcfe' },
        { token: 'delimiter', foreground: 'd4d4d4' },
    ],
    colors: {
        ...COMMON_COLORS,
        'editorLineNumber.foreground': '#6e7681',
        'editorLineNumber.activeForeground': '#c9d1d9',
    },
});

const LANGUAGES: Record<string, string> = {
    php: 'php',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    // * Monaco has no Vue mode: the HTML one colours <template> and the <script>/<style> blocks inside.
    vue: 'html',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    sh: 'shell',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    ini: 'ini',
    mk: 'shell',
    conf: 'ini',
    properties: 'ini',
    toml: 'ini',
};

// * Config files named by their whole name (no extension, or a dotfile): `.prettierrc` is JSON, `.env` and `.editorconfig` are ini-like; ignore files and Makefiles borrow the shell colours (`#` comments, strings, variables).
const FILE_NAMES: Record<string, string> = {
    '.prettierrc': 'json',
    '.eslintrc': 'json',
    '.babelrc': 'json',
    '.stylelintrc': 'json',
    '.swcrc': 'json',
    '.editorconfig': 'ini',
    '.npmrc': 'ini',
    '.gitconfig': 'ini',
    '.gitattributes': 'ini',
    '.gitmodules': 'ini',
    '.gitignore': 'shell',
    '.dockerignore': 'shell',
    '.npmignore': 'shell',
    '.env': 'ini',
    dockerfile: 'dockerfile',
    makefile: 'shell',
    gnumakefile: 'shell',
    'composer.lock': 'json',
};

export function languageOf(path: string): string {
    const name = path.split('/').pop()?.toLowerCase() ?? '';

    return (
        FILE_NAMES[name] ??
        (name.startsWith('.env.') ? 'ini' : undefined) ??
        LANGUAGES[name.split('.').pop() ?? ''] ??
        'plaintext'
    );
}

/** * Light/dark theme name following the page's own theme. */
export function monacoTheme(): string {
    return document.documentElement.classList.contains('dark')
        ? 'pm-dark'
        : 'pm-light';
}

/** * Options shared by the file view and the diff view: read-only, quiet. */
export const READ_ONLY_OPTIONS = {
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    // * Long lines stay on one row and scroll sideways: a wrapped line loses its indent and reads as a separate line.
    wordWrap: 'off',
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontLigatures: false,
    padding: { top: 12, bottom: 12 },
    lineNumbersMinChars: 4,
    lineDecorationsWidth: 12,
    stickyScroll: { enabled: false },
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    guides: { indentation: true, bracketPairs: false },
    bracketPairColorization: { enabled: false },
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    matchBrackets: 'never',
    smoothScrolling: true,
    scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false,
    },
    renderWhitespace: 'none',
    hover: { enabled: 'off' },
    automaticLayout: true,
} as const;
