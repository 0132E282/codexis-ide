import {
    File as FileIcon,
    FileArchive,
    FileAudio,
    Folder,
    FileSpreadsheet,
    FileText,
    FileVideo,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';

export type FileViewerValue =
    | File
    | string
    | { url: string; name?: string; alt?: string }
    | { file: File; name?: string; alt?: string }
    | null;

const IMAGE_EXTENSIONS = [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'svg',
    'avif',
    'bmp',
];

const EXTENSION_ICONS: Record<string, typeof FileIcon> = {
    pdf: FileText,
    doc: FileText,
    docx: FileText,
    txt: FileText,
    csv: FileSpreadsheet,
    xls: FileSpreadsheet,
    xlsx: FileSpreadsheet,
    zip: FileArchive,
    rar: FileArchive,
    '7z': FileArchive,
    mp3: FileAudio,
    wav: FileAudio,
    mp4: FileVideo,
    mov: FileVideo,
    webm: FileVideo,
};

export function getRawFile(value: FileViewerValue): File | null {
    if (value instanceof File) {
        return value;
    }

    if (value && typeof value === 'object' && 'file' in value) {
        return value.file;
    }

    return null;
}

export function getFileName(value: FileViewerValue): string {
    if (!value) {
        return '';
    }

    if (typeof value === 'string') {
        return value.split('/').pop() ?? value;
    }

    const rawFile = getRawFile(value);

    if (value instanceof File) {
        return value.name;
    }

    return (
        value.name ??
        rawFile?.name ??
        ('url' in value ? (value.url.split('/').pop() ?? value.url) : '')
    );
}

function getFileAlt(value: FileViewerValue): string | undefined {
    if (!value || typeof value === 'string' || value instanceof File) {
        return undefined;
    }

    return value.alt;
}

export function getFileUrl(value: FileViewerValue): string | null {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof File) {
        return null;
    }

    return 'url' in value ? value.url : null;
}

function getExtension(fileName: string): string {
    const parts = fileName.split('.');

    return parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
}

function resolveExtension(value: FileViewerValue, fileName: string): string {
    const fromName = getExtension(fileName);

    if (fromName) {
        return fromName;
    }

    const url = getFileUrl(value);

    if (!url) {
        return '';
    }

    const cleanUrl = url.split('?')[0].split('#')[0];

    return getExtension(cleanUrl.split('/').pop() ?? '');
}

export function FileViewer({
    file,
    isFolder = false,
    className,
}: {
    file: FileViewerValue;
    isFolder?: boolean;
    className?: string;
}) {
    const fileName = useMemo(() => getFileName(file), [file]);
    const fileAlt = useMemo(() => getFileAlt(file), [file]);
    const extension = useMemo(
        () => resolveExtension(file, fileName),
        [file, fileName],
    );
    const isImage = !isFolder && IMAGE_EXTENSIONS.includes(extension);

    const objectUrl = useMemo(() => {
        const rawFile = getRawFile(file);

        if (rawFile && isImage) {
            return URL.createObjectURL(rawFile);
        }

        return null;
    }, [file, isImage]);

    useEffect(() => {
        return () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [objectUrl]);

    if (isFolder) {
        return (
            <div
                className={cn(
                    'flex items-center justify-center text-muted-foreground',
                    className,
                )}
            >
                <Folder className="size-8" />
            </div>
        );
    }

    if (!file) {
        return null;
    }

    const imageSrc = objectUrl ?? getFileUrl(file);

    if (isImage && imageSrc) {
        return (
            <img
                src={imageSrc}
                alt={fileAlt ?? fileName}
                className={cn('size-full object-cover', className)}
            />
        );
    }

    const Icon = EXTENSION_ICONS[extension] ?? FileIcon;

    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center gap-1 p-2 text-muted-foreground',
                className,
            )}
        >
            <Icon className="size-6" />
            <span className="w-full truncate text-center text-[10px]">
                {fileName}
            </span>
        </div>
    );
}

export default FileViewer;
