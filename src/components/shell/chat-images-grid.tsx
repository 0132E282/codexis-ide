import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/use-confirm';
import { formatBytes } from '@/lib/format-bytes';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/ide';
import { ideActivity } from '@/lib/ide-activity';
import type { ChatImage } from '@/lib/ide-activity';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 100;

/** The source of a picture: its small copy when the database sent one (`thumbnailBase64`), else null and the picture is read when shown. */
function useImageUrl(image: ChatImage): string | null {
    const [fetched, setFetched] = useState<string | null>(null);
    const embedded =
        image.thumbnailBase64 === null
            ? null
            : `data:${image.mime};base64,${image.thumbnailBase64}`;

    useEffect(() => {
        if (embedded !== null) {
            return;
        }

        let current = true;

        ideActivity.chatImageGet(image.id).then(
            (data) =>
                current &&
                setFetched(`data:${data.mime};base64,${data.dataBase64}`),
            () => undefined,
        );

        return () => {
            current = false;
        };
    }, [image.id, embedded]);

    return embedded ?? fetched;
}

function ImageTile({
    image,
    checked,
    onCheck,
    onOpen,
}: {
    image: ChatImage;
    checked: boolean;
    onCheck: (checked: boolean) => void;
    onOpen: () => void;
}) {
    const url = useImageUrl(image);

    return (
        <li
            className={cn(
                'group relative aspect-square overflow-hidden rounded-md border bg-muted',
                checked && 'ring-2 ring-primary',
            )}
        >
            <button
                type="button"
                onClick={onOpen}
                title={`${image.name} · ${formatBytes(image.sizeBytes)}`}
                className="size-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
                {url !== null && (
                    <img
                        src={url}
                        alt={image.name}
                        loading="lazy"
                        className="size-full object-cover"
                    />
                )}
            </button>
            <span className="absolute top-1 left-1 rounded-sm bg-background/80 p-0.5">
                <Checkbox
                    aria-label={image.name}
                    checked={checked}
                    onCheckedChange={(value) => onCheck(value === true)}
                />
            </span>
        </li>
    );
}

function ViewerBody({ image }: { image: ChatImage }) {
    const url = useImageUrl(image);

    return (
        <>
            <DialogTitle>{image.name}</DialogTitle>
            <DialogDescription>
                {`${formatBytes(image.sizeBytes)} · ${new Date(image.createdAt * 1000).toLocaleString()}`}
            </DialogDescription>
            {url !== null && (
                <img
                    src={url}
                    alt={image.name}
                    className="max-h-[70vh] w-full object-contain"
                />
            )}
        </>
    );
}

function ImageViewer({
    image,
    onClose,
}: {
    image: ChatImage | null;
    onClose: () => void;
}) {
    return (
        <Dialog
            open={image !== null}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent className="max-w-3xl">
                {image !== null && <ViewerBody image={image} />}
            </DialogContent>
        </Dialog>
    );
}

/** The pictures of the chat kept in the database: a grid with a large view and deletion of the picked ones. */
export function ChatImagesGrid({ root }: { root: string | undefined }) {
    const [images, setImages] = useState<ChatImage[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [viewing, setViewing] = useState<ChatImage | null>(null);
    const [refreshTick, setRefreshTick] = useState(0);
    const { confirm, dialog } = useConfirm();

    useEffect(() => {
        let current = true;

        ideActivity.chatImagesList(PAGE_SIZE, 0, root).then(
            (result) => {
                if (current) {
                    setImages(result.items);
                    setTotal(result.total);
                    setPicked(new Set());
                    setError(null);
                    setLoading(false);
                }
            },
            (failure: unknown) => {
                if (current) {
                    setError(errorText(failure));
                    setLoading(false);
                }
            },
        );

        return () => {
            current = false;
        };
    }, [root, refreshTick]);

    const loadMore = async () => {
        try {
            const result = await ideActivity.chatImagesList(
                PAGE_SIZE,
                images.length,
                root,
            );

            setImages((existing) => [...existing, ...result.items]);
            setTotal(result.total);
        } catch (failure) {
            toast.error(t(errorText(failure)));
        }
    };

    const deletePicked = async () => {
        const approved = await confirm({
            title: t('data_pane.delete_title'),
            description: t('data_pane.images_delete_description', {
                count: picked.size,
            }),
            action: t('common.delete'),
        });

        if (!approved) {
            return;
        }

        try {
            await ideActivity.chatImagesDelete([...picked]);
            setRefreshTick((tick) => tick + 1);
        } catch (failure) {
            toast.error(t(errorText(failure)));
        }
    };

    return (
        <div className="flex w-full min-w-0 flex-col gap-2 p-2 text-xs">
            {dialog}
            <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                    {t('data_pane.total', { count: total })}
                </span>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="ml-auto shrink-0"
                    disabled={picked.size === 0}
                    onClick={() => void deletePicked()}
                >
                    {t('data_pane.delete_selected', { count: picked.size })}
                </Button>
            </div>
            {error !== null && (
                <p role="alert" className="text-destructive">
                    {t(error)}
                </p>
            )}
            {loading && (
                <p className="text-muted-foreground">{t('history.loading')}</p>
            )}
            {!loading && error === null && images.length === 0 && (
                <p className="text-muted-foreground">
                    {t('data_pane.images_empty')}
                </p>
            )}
            <ul className="grid w-full grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                {images.map((image) => (
                    <ImageTile
                        key={image.id}
                        image={image}
                        checked={picked.has(image.id)}
                        onCheck={(checked) =>
                            setPicked((current) => {
                                const next = new Set(current);

                                if (checked) {
                                    next.add(image.id);
                                } else {
                                    next.delete(image.id);
                                }

                                return next;
                            })
                        }
                        onOpen={() => setViewing(image)}
                    />
                ))}
            </ul>
            {images.length < total && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => void loadMore()}
                >
                    {t('history.load_more')}
                </Button>
            )}
            <ImageViewer image={viewing} onClose={() => setViewing(null)} />
        </div>
    );
}
