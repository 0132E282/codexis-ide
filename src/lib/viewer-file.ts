import { looksLikeSvg, readSvgFile } from '@/lib/svg-file';
import { t } from '@/lib/i18n';

/** * Largest source shown as a file card; anything bigger stays a plain code block. */
const MAX_FILE_BYTES = 500 * 1024;
/** * A block without a file name must be longer than this to become a card. */
const MIN_LINES_WITHOUT_NAME = 15;

export type FileType = {
    /** Extension of the download and label of the type. */
    ext: string;
    label: string;
    /** `image` = rendered preview of an image (svg), `html` = sandboxed page, `markdown`, `code` = code tab only. */
    kind: 'svg' | 'html' | 'md' | 'code';
    icon: 'image' | 'code' | 'text' | 'sheet';
};

const TYPES: Record<string, FileType> = {
    svg: { ext: 'svg', label: 'SVG', kind: 'svg', icon: 'image' },
    html: { ext: 'html', label: 'HTML', kind: 'html', icon: 'code' },
    md: { ext: 'md', label: 'MD', kind: 'md', icon: 'text' },
    json: { ext: 'json', label: 'JSON', kind: 'code', icon: 'code' },
    css: { ext: 'css', label: 'CSS', kind: 'code', icon: 'code' },
    js: { ext: 'js', label: 'JS', kind: 'code', icon: 'code' },
    ts: { ext: 'ts', label: 'TS', kind: 'code', icon: 'code' },
    tsx: { ext: 'tsx', label: 'TSX', kind: 'code', icon: 'code' },
    php: { ext: 'php', label: 'PHP', kind: 'code', icon: 'code' },
    py: { ext: 'py', label: 'PY', kind: 'code', icon: 'code' },
    sh: { ext: 'sh', label: 'SH', kind: 'code', icon: 'code' },
    sql: { ext: 'sql', label: 'SQL', kind: 'code', icon: 'code' },
    txt: { ext: 'txt', label: 'TXT', kind: 'code', icon: 'text' },
    csv: { ext: 'csv', label: 'CSV', kind: 'code', icon: 'sheet' },
    yaml: { ext: 'yaml', label: 'YAML', kind: 'code', icon: 'code' },
};

/** * Fence language (or file extension) => key of TYPES. Anything not listed is never a file. */
const ALIASES: Record<string, string> = {
    htm: 'html',
    markdown: 'md',
    javascript: 'js',
    mjs: 'js',
    typescript: 'ts',
    python: 'py',
    bash: 'sh',
    shell: 'sh',
    zsh: 'sh',
    text: 'txt',
    yml: 'yaml',
};

const typeOf = (key: string | null | undefined): FileType | null => {
    const lowered = (key ?? '').toLowerCase();

    return TYPES[ALIASES[lowered] ?? lowered] ?? null;
};

export type ViewerFile = {
    type: FileType;
    /** Shown in the card and the viewer header. */
    title: string;
    /** Download name: letters, digits, dot, dash and underscore only, with the extension from the allowlist. */
    fileName: string;
    /** The code exactly as written (Code tab, preview of html/markdown). */
    source: string;
    /** svg only: the sanitised copy used for the preview and the download. */
    safe?: string;
};

/**
 * Download name from whatever the model wrote: the path is dropped, only safe characters stay and the extension always comes from the type's allowlist.
 */
function safeFileName(name: string, ext: string): string {
    const base = (name.split(/[\\/]/).pop() ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/gi, 'd')
        .replace(/\.[A-Za-z0-9]{1,5}$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[-._]+|[-._]+$/g, '')
        .slice(0, 60);

    return `${base === '' ? 'tep' : base}.${ext}`;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

const lineCount = (text: string) => text.trim().split('\n').length;

const isCompleteHtml = (code: string) =>
    /^\s*(<!doctype html|<html[\s>])/i.test(code) && /<\/html>\s*$/i.test(code);

/**
 * Decides whether a fenced block is a file card (null = keep the plain code block).
 * Named blocks (`title="src/app.php"`) are files when the extension is allowlisted; unnamed ones only when they are a complete svg/html document or a long block of a known type. Over the size cap, never.
 */
export function detectFile(
    language: string | undefined,
    name: string | null,
    code: string,
): ViewerFile | null {
    const trimmed = code.trim();

    if (trimmed === '' || byteLength(trimmed) > MAX_FILE_BYTES) {
        return null;
    }

    const extension = name && /\.([A-Za-z0-9]{1,5})$/.exec(name.trim())?.[1];
    const fromName = typeOf(extension);
    const fromLanguage = typeOf(language);
    const type = fromName ?? fromLanguage;

    if (!type) {
        return null;
    }

    if (type.kind === 'svg') {
        if (!looksLikeSvg(trimmed)) {
            return null;
        }

        const svg = readSvgFile(trimmed);

        return svg
            ? {
                  type,
                  title: name ? name.split(/[\\/]/).pop()! : svg.title,
                  fileName: safeFileName(name ?? svg.title, type.ext),
                  source: svg.source,
                  safe: svg.safe,
              }
            : null;
    }

    const named = fromName !== null;
    const complete =
        type.kind === 'html'
            ? isCompleteHtml(trimmed)
            : lineCount(trimmed) > MIN_LINES_WITHOUT_NAME;

    if (!named && !complete) {
        return null;
    }

    const title = name
        ? (name.split(/[\\/]/).pop() ?? name)
        : t('viewer_file.label_file', { label: type.label });

    return {
        type,
        title,
        fileName: safeFileName(name ?? title, type.ext),
        source: trimmed,
    };
}

/** * Saves the file through a short-lived object URL (revoked right after the click). svg downloads the sanitised copy; everything else is plain bytes (octet-stream), never served as a page. */
export function downloadViewerFile(file: ViewerFile): void {
    const blob =
        file.type.kind === 'svg'
            ? new Blob([file.safe ?? ''], { type: 'image/svg+xml' })
            : new Blob([file.source], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = file.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
