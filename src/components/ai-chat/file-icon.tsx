import { useEffect, useState } from 'react';
import { fileIconUrl } from '@/lib/file-icons';
import { cn } from '@/lib/utils';

/** * Material-theme icon of a file or folder in the code tree; the space is reserved while the SVG loads. */
export function FileIcon({
    name,
    dir = false,
    open = false,
    className,
}: {
    name: string;
    dir?: boolean;
    open?: boolean;
    className?: string;
}) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        fileIconUrl(name, dir, open)
            .then((value) => !cancelled && setUrl(value))
            .catch(() => !cancelled && setUrl(null));

        return () => {
            cancelled = true;
        };
    }, [name, dir, open]);

    return (
        <span
            aria-hidden="true"
            className={cn('inline-block size-4 shrink-0', className)}
        >
            {url !== null && (
                <img src={url} alt="" className="size-full" draggable={false} />
            )}
        </span>
    );
}
