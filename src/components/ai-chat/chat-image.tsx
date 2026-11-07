import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { mediaMime } from '@/lib/media-file';
import { cn } from '@/lib/utils';

const LOCAL_IMAGE = /^(?![a-z][a-z0-9+.-]*:)[^?#]+\.(png|jpe?g|gif|webp)$/i;

/** Whether `url` is a path on this machine (relative, or absolute) to a picture, not a link with a scheme. */
export function isLocalImagePath(url: string): boolean {
    return LOCAL_IMAGE.test(url);
}

/** A picture in the answer: click to see it at full size. */
export function ChatImage({ src, alt }: { src: string; alt: string }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <button
            type="button"
            title={alt}
            aria-label={alt || undefined}
            onClick={() => setExpanded(!expanded)}
            className="my-2 block max-w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
            <img
                src={src}
                alt={alt}
                className={cn(
                    'rounded-lg border object-contain',
                    expanded ? 'max-w-full cursor-zoom-out' : 'max-h-72',
                )}
            />
        </button>
    );
}

/** A picture the AI saved on disk (inside the project or a temp folder): read through the backend, which refuses any other path. Shows the path while it loads or when it cannot be read. */
export function LocalImage({ path, alt }: { path: string; alt: string }) {
    const [source, setSource] = useState<string | null>(null);

    useEffect(() => {
        const mime = mediaMime(path);
        let url: string | null = null;
        let cancelled = false;

        invoke<ArrayBuffer>('chat_image_read', { path })
            .then((bytes) => {
                if (!cancelled) {
                    url = URL.createObjectURL(
                        new Blob([bytes], { type: mime ?? 'image/png' }),
                    );
                    setSource(url);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;

            if (url !== null) {
                URL.revokeObjectURL(url);
            }
        };
    }, [path]);

    return source === null ? (
        <span className="font-mono text-xs break-all">{alt || path}</span>
    ) : (
        <ChatImage src={source} alt={alt || path} />
    );
}
