import { t } from '@/lib/i18n';
/** * Largest SVG source shown as a file card; anything bigger stays a plain code block. */
const MAX_SVG_BYTES = 500 * 1024;

const DEFAULT_SVG_TITLE = 'svg_file.svg_image';

export type SvgFile = {
    title: string;
    /** The code exactly as the assistant wrote it (shown in the Code tab). */
    source: string;
    /** Sanitised copy used for the preview and the download: no scripts, handlers or external references. */
    safe: string;
};

const encoder = new TextEncoder();

/** * Cheap check before any parsing: a size cap and an `<svg ...>...</svg>` envelope. */
export function looksLikeSvg(code: string): boolean {
    const text = code.trim();

    return (
        text.length > 0 &&
        encoder.encode(text).length <= MAX_SVG_BYTES &&
        /^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text) &&
        /<\/svg>\s*$/i.test(text)
    );
}

/** * Title from a `<title>` element, else the first leading comment; null when there is none. */
function svgTitleFromSource(code: string): string | null {
    const element = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(code)?.[1];
    const comment = /^\s*(?:<\?xml[^>]*\?>\s*)?<!--([\s\S]*?)-->/i.exec(
        code,
    )?.[1];
    const title = (element ?? comment ?? '').replace(/\s+/g, ' ').trim();

    return title === '' ? null : title.slice(0, 80);
}

const BLOCKED_ELEMENTS = new Set([
    'script',
    'foreignobject',
    'iframe',
    'object',
    'embed',
    'audio',
    'video',
    'canvas',
    'link',
    'meta',
]);

const externalUrl = (value: string) =>
    /url\(\s*['"]?\s*(?!#)/i.test(value) ||
    /@import|expression\(|javascript:/i.test(value);

/** * Removes everything that could run or load something: scripts, event handlers, external hrefs/urls. Returns null if the markup is not a valid SVG. */
function sanitizeSvg(source: string): string | null {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = document.documentElement;

    if (
        document.getElementsByTagName('parsererror').length > 0 ||
        root.localName.toLowerCase() !== 'svg'
    ) {
        return null;
    }

    for (const element of Array.from(root.querySelectorAll('*'))) {
        const name = element.localName.toLowerCase();

        if (
            BLOCKED_ELEMENTS.has(name) ||
            (name === 'style' && externalUrl(element.textContent ?? '')) ||
            ((name === 'set' || name === 'animate') &&
                /href/i.test(element.getAttribute('attributeName') ?? ''))
        ) {
            element.remove();
        }
    }

    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim();

            if (
                name.startsWith('on') ||
                ((name === 'href' || name.endsWith(':href')) &&
                    !value.startsWith('#')) ||
                externalUrl(value)
            ) {
                element.removeAttribute(attribute.name);
            }
        }
    }

    return new XMLSerializer().serializeToString(root);
}

/** * The file card data for a fenced block, or null (too big, not an SVG, malformed) so the caller keeps the plain code block. */
export function readSvgFile(code: string): SvgFile | null {
    if (!looksLikeSvg(code)) {
        return null;
    }

    const safe = sanitizeSvg(code.trim());

    return safe === null
        ? null
        : {
              title: svgTitleFromSource(code) ?? t(DEFAULT_SVG_TITLE),
              source: code.trim(),
              safe,
          };
}
