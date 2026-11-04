import manifestUrl from 'material-icon-theme/dist/material-icons.json?url';

// * File and folder icons of the "Material Icon Theme" (the VS Code set). The name tables are fetched once, on first use; each SVG is its own lazy asset, loaded only when a row needs it.
const ICON_FILES = import.meta.glob(
    '../../node_modules/material-icon-theme/icons/*.svg',
    { query: '?url', import: 'default' },
) as Record<string, () => Promise<string>>;

type Manifest = {
    iconDefinitions: Record<string, { iconPath: string }>;
    fileNames: Record<string, string>;
    fileExtensions: Record<string, string>;
    folderNames: Record<string, string>;
    folderNamesExpanded: Record<string, string>;
    file: string;
    folder: string;
    folderExpanded: string;
};

let manifestPromise: Promise<Manifest> | null = null;
const urls = new Map<string, Promise<string | null>>();

function loadManifest(): Promise<Manifest> {
    manifestPromise ??= fetch(manifestUrl).then((response) => response.json());

    return manifestPromise;
}

/** * Icon id for a file or folder name, like VS Code: the full name first, then the longest extension (`d.ts` before `ts`), else the plain file/folder icon. */
function iconId(
    manifest: Manifest,
    name: string,
    dir: boolean,
    open: boolean,
): string {
    const lower = name.toLowerCase();

    if (dir) {
        return (
            (open ? manifest.folderNamesExpanded : manifest.folderNames)[
                lower
            ] ?? (open ? manifest.folderExpanded : manifest.folder)
        );
    }

    if (manifest.fileNames[lower] !== undefined) {
        return manifest.fileNames[lower];
    }

    const parts = lower.split('.');

    for (let index = 1; index < parts.length; index++) {
        const found = manifest.fileExtensions[parts.slice(index).join('.')];

        if (found !== undefined) {
            return found;
        }
    }

    return manifest.file;
}

/** * URL of the SVG for a file or folder name; null when the set has no such file. */
export async function fileIconUrl(
    name: string,
    dir: boolean,
    open: boolean,
): Promise<string | null> {
    const manifest = await loadManifest();
    const id = iconId(manifest, name, dir, open);
    let url = urls.get(id);

    if (url === undefined) {
        const file = manifest.iconDefinitions[id]?.iconPath.split('/').pop();
        const load =
            ICON_FILES[`../../node_modules/material-icon-theme/icons/${file}`];

        url = load ? load() : Promise.resolve(null);
        urls.set(id, url);
    }

    return url;
}
