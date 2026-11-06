import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment } from '@/components/shell/chat/attachment';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';
import { errorText, ide } from '@/lib/ide';
import { t } from '@/lib/i18n';

function releasePreview(attachment: Attachment) {
    if (attachment.preview !== null) {
        URL.revokeObjectURL(attachment.preview);
    }
}

/** The files waiting to be sent with the message: pasted images and files, pasted paths, and files double-clicked in the tree. Every callback is stable. */
export function useAttachments(
    root: string,
    attachFile: { path: string; n: number } | null,
) {
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [attachError, setAttachError] = useState<string | null>(null);
    const attachmentCounter = useRef(0);

    // * Pasted images and files are saved by the backend; the message then points the CLI at them with `@path`.
    const pasteFiles = useCallback((files: File[]) => {
        setAttachError(null);
        files.forEach((file) =>
            ide
                .saveAttachment(file)
                .then((path) =>
                    setAttachments((current) => [
                        ...current,
                        {
                            id: `attachment-${attachmentCounter.current++}`,
                            name: file.name || t('use_attachments.file'),
                            path,
                            preview: file.type.startsWith('image/')
                                ? URL.createObjectURL(file)
                                : null,
                        },
                    ]),
                )
                .catch((caught) => setAttachError(errorText(caught))),
        );
    }, []);

    // * A path on disk is attached as it is: nothing to copy.
    const pastePaths = useCallback((paths: string[]) => {
        setAttachError(null);
        setAttachments((current) => [
            ...current,
            ...paths.map((path) => ({
                id: `attachment-${attachmentCounter.current++}`,
                name: path.split('/').pop() ?? path,
                path,
                preview: null,
            })),
        ]);
    }, []);

    // * A double click in the tree attaches that file (once; a click on one already attached changes nothing).
    useEffect(() => {
        if (attachFile === null) {
            return;
        }

        const path = `${root.replace(/\/$/, '')}/${attachFile.path}`;

        setAttachments((current) =>
            current.some((item) => item.path === path)
                ? current
                : [
                      ...current,
                      {
                          id: `attachment-${attachmentCounter.current++}`,
                          name: attachFile.path.split('/').pop() ?? path,
                          path,
                          preview: null,
                      },
                  ],
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attachFile]);

    const removeAttachment = useStableCallback((id: string) => {
        const removed = attachments.find((item) => item.id === id);

        if (removed !== undefined) {
            releasePreview(removed);
        }

        setAttachments((current) => current.filter((item) => item.id !== id));
    });

    /** The message was sent: the thumbnails are let go and the list is emptied. */
    const clearAfterSend = useStableCallback(() => {
        attachments.forEach(releasePreview);
        setAttachments([]);
        setAttachError(null);
    });

    /** Another conversation is shown: the list is emptied. */
    const reset = useCallback(() => {
        setAttachments([]);
        setAttachError(null);
    }, []);

    return {
        attachments,
        attachError,
        pasteFiles,
        pastePaths,
        removeAttachment,
        clearAfterSend,
        reset,
    };
}
