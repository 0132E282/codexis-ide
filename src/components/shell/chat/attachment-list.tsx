import { FileText, X } from 'lucide-react';
import type { Attachment } from '@/components/shell/chat/attachment';

/** The files waiting to be sent, as thumbnails with a button to drop each, and the reason the last paste was refused. */
export function AttachmentList({
    attachments,
    attachError,
    onRemove,
}: {
    attachments: Attachment[];
    attachError: string | null;
    onRemove: (id: string) => void;
}) {
    return (
        <>
            {attachments.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                        <li
                            key={attachment.id}
                            title={attachment.name}
                            className="relative size-20 overflow-hidden rounded-md border bg-background"
                        >
                            {attachment.preview !== null ? (
                                <img
                                    src={attachment.preview}
                                    alt={attachment.name}
                                    className="size-full object-cover"
                                />
                            ) : (
                                <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-xs text-muted-foreground">
                                    <FileText
                                        aria-hidden="true"
                                        className="size-6"
                                    />
                                    <span className="w-full truncate text-center">
                                        {attachment.name}
                                    </span>
                                </span>
                            )}
                            <button
                                type="button"
                                aria-label={`Bỏ ${attachment.name}`}
                                onClick={() => onRemove(attachment.id)}
                                className="absolute top-1 right-1 rounded-sm bg-background/80 p-0.5 text-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                <X aria-hidden="true" className="size-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {attachError !== null && (
                <p role="alert" className="mb-2 text-xs text-destructive">
                    {attachError}
                </p>
            )}
        </>
    );
}
