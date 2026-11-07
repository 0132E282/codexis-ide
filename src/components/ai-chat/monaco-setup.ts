import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { CODE_PALETTES, type CodeScheme } from '@/lib/code-palettes';
import { getThemeState, subscribeTheme } from '@/lib/system-theme';

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

// * One Monaco theme per color scheme (`pm-light`, `pm-dark`, `pm-light-cb`, `pm-dark-cb`), built from the palettes the settings preview also shows.
const THEME_NAMES: Record<CodeScheme, string> = {
    light: 'pm-light',
    dark: 'pm-dark',
    'light-colorblind': 'pm-light-cb',
    'dark-colorblind': 'pm-dark-cb',
};

for (const scheme of Object.keys(CODE_PALETTES) as CodeScheme[]) {
    const palette = CODE_PALETTES[scheme];
    const hex = (color: string) => color.slice(1);

    monaco.editor.defineTheme(THEME_NAMES[scheme], {
        base: palette.base,
        inherit: true,
        rules: [
            { token: 'comment', foreground: hex(palette.comment) },
            { token: 'keyword', foreground: hex(palette.keyword) },
            { token: 'metatag', foreground: hex(palette.keyword) },
            { token: 'string', foreground: hex(palette.string) },
            { token: 'number', foreground: hex(palette.number) },
            { token: 'type', foreground: hex(palette.type) },
            { token: 'tag', foreground: hex(palette.tag) },
            { token: 'attribute.name', foreground: hex(palette.attribute) },
            { token: 'variable', foreground: hex(palette.variable) },
            { token: 'delimiter', foreground: hex(palette.delimiter) },
        ],
        colors: {
            ...COMMON_COLORS,
            'editorLineNumber.foreground': palette.lineNumber,
            'editorLineNumber.activeForeground': palette.activeLineNumber,
        },
    });
}

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
    const { codeColors } = getThemeState();

    if (codeColors !== 'auto') {
        return THEME_NAMES[codeColors];
    }

    return document.documentElement.classList.contains('dark')
        ? 'pm-dark'
        : 'pm-light';
}

// * The look or the code colors changed (a setting, or the system switching between light and dark): every open editor takes the new colors at once.
subscribeTheme(() => monaco.editor.setTheme(monacoTheme()));

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
