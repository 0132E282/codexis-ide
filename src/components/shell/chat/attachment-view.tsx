import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import logo from '@/assets/logo.png';
import { ide } from '@/lib/ide';

const IMAGE_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};

/** An attached file in the message: an image is shown as a picture, anything else (or an image that cannot be read) as a chip. */
export function AttachmentView({ path, name }: { path: string; name: string }) {
    const type = IMAGE_TYPES[(path.split('.').pop() ?? '').toLowerCase()];
    const [source, setSource] = useState<string | null>(null);

    useEffect(() => {
        if (type === undefined) {
            return;
        }

        let url: string | null = null;
        let cancelled = false;

        ide.readAttachment(path)
            .then((bytes) => {
                if (!cancelled) {
                    url = URL.createObjectURL(new Blob([bytes], { type }));
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
    }, [path, type]);

    if (source !== null) {
        return (
            <img
                src={source}
                alt={name}
                title={name}
                className="size-20 rounded-lg border object-cover"
            />
        );
    }

    // * An image that is still loading, or cannot be read, shows the app logo in the same square.
    if (type !== undefined) {
        return (
            <img
                src={logo}
                alt={name}
                title={name}
                className="size-20 rounded-lg border bg-card object-contain p-4 opacity-60"
            />
        );
    }

    return (
        <span
            title={path}
            className="flex max-w-60 items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
        >
            <FileText aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{name}</span>
        </span>
    );
}
