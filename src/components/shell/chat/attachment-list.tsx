import { FileText, X } from 'lucide-react';
import { FileIcon } from '@/components/ai-chat/file-icon';
import {
    formatLines,
    type Attachment,
} from '@/components/shell/chat/attachment';
import { t } from '@/lib/i18n';

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
                    {attachments.map((attachment) =>
                        attachment.selected === true ||
                        attachment.lines !== undefined ? (
                            // * The file selected in the tree: a slim rectangle (file-type icon, name, remove) instead of a thumbnail.
                            <li
                                key={attachment.id}
                                title={
                                    attachment.lines === undefined
                                        ? attachment.path
                                        : `${attachment.path}:${formatLines(attachment.lines)}`
                                }
                                className="flex h-8 max-w-64 items-center gap-1.5 rounded-md border bg-muted/50 pr-1 pl-2 text-xs"
                            >
                                <FileIcon
                                    name={attachment.name}
                                    className="size-4 shrink-0"
                                />
                                <span className="min-w-0 truncate">
                                    {attachment.lines === undefined
                                        ? attachment.name
                                        : `${attachment.name}:${formatLines(attachment.lines)}`}
                                </span>
                                <button
                                    type="button"
                                    aria-label={t('common.remove_name', {
                                        name: attachment.name,
                                    })}
                                    onClick={() => onRemove(attachment.id)}
                                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <X
                                        aria-hidden="true"
                                        className="size-3.5"
                                    />
                                </button>
                            </li>
                        ) : (
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
                                    aria-label={t('common.remove_name', {
                                        name: attachment.name,
                                    })}
                                    onClick={() => onRemove(attachment.id)}
                                    className="absolute top-1 right-1 rounded-sm bg-background/80 p-0.5 text-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <X
                                        aria-hidden="true"
                                        className="size-3.5"
                                    />
                                </button>
                            </li>
                        ),
                    )}
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
