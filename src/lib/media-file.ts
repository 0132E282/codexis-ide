import { invoke } from '@tauri-apps/api/core';

const MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
};

/** MIME type of a picture or PDF that the viewer shows as media; null for any other file. */
export function mediaMime(path: string): string | null {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';

    return MIME_BY_EXTENSION[extension] ?? null;
}

export function isPdfSource(source: string): boolean {
    return source.startsWith('data:application/pdf');
}

/** A picture or PDF of the open project as a data URL the page can show. */
export async function readMedia(path: string, mime: string): Promise<string> {
    const bytes = await invoke<ArrayBuffer>('workspace_read_media', { path });

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([bytes], { type: mime }));
    });
}
