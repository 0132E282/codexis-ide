import { ArrowUpRight, ChevronDown, ChevronRight, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FileContextMenu } from '@/components/ai-chat/file-context-menu';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { LoadingRows } from '@/components/ai-chat/loading-rows';
import { UnifiedDiff } from '@/components/ai-chat/unified-diff';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { isPdfSource, mediaMime, readMedia } from '@/lib/media-file';
import { requestErrorMessage } from '@/lib/ai-error';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';

export type Change = {
    path: string;
    status: 'M' | 'A' | 'D';
    added: number | null;
    removed: number | null;
};

// * The last list of each project: coming back to the tab shows it at once while a fresh one loads.
const cache = new Map<string, { git: boolean; files: Change[] }>();

// * How often the list follows the working tree while the tab is visible.
const REFRESH_MS = 6000;

export type LocalChangeList = {
    files: Change[] | null;
    git: boolean;
    error: string | null;
    /** * Reads the list again now (after a change made from here). */
    refresh: () => void;
};

/** * The files of a local project that differ from git `HEAD`; follows the working tree while the tab is visible. */
export function useLocalChanges(root: string | null): LocalChangeList {
    const [files, setFiles] = useState<Change[] | null>(() =>
        root ? (cache.get(root)?.files ?? null) : null,
    );
    const [git, setGit] = useState(() =>
        root ? (cache.get(root)?.git ?? true) : true,
    );
    const [error, setError] = useState<string | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (root === null) {
            return;
        }

        let cancelled = false;

        const load = () => {
            if (document.hidden) {
                return;
            }

            api.get<{ git: boolean; files: Change[] }>(
                '/ai-chat/local/changes',
                { params: { root } },
            )
                .then(({ data }) => {
                    cache.set(root, data);

                    if (!cancelled) {
                        setFiles(data.files);
                        setGit(data.git);
                        setError(null);
                    }
                })
                .catch((caught) => {
                    if (!cancelled) {
                        setError(
                            requestErrorMessage(
                                caught,
                                'Không tải được danh sách thay đổi.',
                            ),
                        );
                    }
                });
        };

        load();
        const timer = window.setInterval(load, REFRESH_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [root, reload]);

    return {
        files,
        git,
        error,
        refresh: () => setReload((count) => count + 1),
    };
}

/** * Every file of a local project that differs from git `HEAD`, one row each; a row opens its diff in place. */
export function LocalChanges({
    root,
    list: { files, git, error, refresh },
    onOpenFile,
    actions,
}: {
    root: string;
    list: LocalChangeList;
    onOpenFile: (path: string) => void;
    actions: FileActions;
}) {
    const [open, setOpen] = useState<Set<string>>(new Set());

    const toggle = (path: string) =>
        setOpen((current) => {
            const next = new Set(current);

            if (!next.delete(path)) {
                next.add(path);
            }

            return next;
        });

    const { confirm, dialog } = useConfirm();

    // * Puts the file back as git `HEAD` has it (a new file is removed); asks first, since the edits are lost.
    const discard = async (file: Change) => {
        if (
            !(await confirm({
                title: 'Hoàn tác thay đổi',
                description: `Hoàn tác mọi thay đổi của ${file.path}? Không thể khôi phục lại.`,
                action: 'Hoàn tác',
            }))
        ) {
            return;
        }

        try {
            await api.post('/ai-chat/local/discard', {
                root,
                path: file.path,
            });
            invalidateAiChatCache(`file.local:${root}.`);
            toast.success(`Đã hoàn tác ${file.path}.`);
            refresh();
        } catch (caught) {
            toast.error(
                requestErrorMessage(caught, 'Không hoàn tác được tệp này.'),
            );
        }
    };

    if (error !== null) {
        return (
            <p role="alert" className="m-4 text-sm text-destructive">
                {error}
            </p>
        );
    }

    if (files === null) {
        return <LoadingRows rows={8} className="px-4 py-3" />;
    }

    if (!git) {
        return (
            <p className="m-4 text-sm text-muted-foreground">
                Thư mục này không phải kho git nên không có danh sách thay đổi.
            </p>
        );
    }

    if (files.length === 0) {
        return (
            <p className="m-4 text-sm text-muted-foreground">
                Không có thay đổi nào so với bản commit gần nhất.
            </p>
        );
    }

    return (
        <>
            {dialog}
            <ul className="min-h-0 flex-1 animate-in overflow-auto duration-200 fade-in motion-reduce:animate-none">
                {files.map((file) => {
                    const name = file.path.split('/').pop() ?? file.path;
                    const dir = file.path.split('/').slice(0, -1).join('/');
                    const expanded = open.has(file.path);

                    return (
                        <li
                            key={file.path}
                            className="border-b last:border-b-0"
                        >
                            <FileContextMenu
                                path={file.path}
                                actions={actions}
                                items={[
                                    {
                                        label: expanded
                                            ? 'Ẩn thay đổi'
                                            : 'Mở thay đổi',
                                        onSelect: () => toggle(file.path),
                                    },
                                    {
                                        label: 'Mở tệp',
                                        disabled: file.status === 'D',
                                        onSelect: () => onOpenFile(file.path),
                                    },
                                    {
                                        label: 'Hoàn tác thay đổi',
                                        onSelect: () => void discard(file),
                                    },
                                ]}
                            >
                                <div className="flex items-center gap-1 pr-2 hover:bg-accent/50">
                                    <button
                                        type="button"
                                        aria-expanded={expanded}
                                        onClick={() => toggle(file.path)}
                                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    >
                                        {expanded ? (
                                            <ChevronDown
                                                aria-hidden="true"
                                                className="size-4 shrink-0 text-muted-foreground"
                                            />
                                        ) : (
                                            <ChevronRight
                                                aria-hidden="true"
                                                className="size-4 shrink-0 text-muted-foreground"
                                            />
                                        )}
                                        <FileIcon
                                            name={name}
                                            className="size-4"
                                        />
                                        <span
                                            className={cn(
                                                'truncate',
                                                file.status === 'A' &&
                                                    'text-green-700 dark:text-green-400',
                                                file.status === 'D' &&
                                                    'text-red-700 line-through dark:text-red-400',
                                            )}
                                        >
                                            {name}
                                        </span>
                                        {dir !== '' && (
                                            <span className="truncate text-xs text-muted-foreground">
                                                {dir}
                                            </span>
                                        )}
                                        <span className="ml-auto flex shrink-0 gap-1.5 text-xs tabular-nums">
                                            {file.added !== null &&
                                                file.added > 0 && (
                                                    <span className="text-green-700 dark:text-green-400">
                                                        +{file.added}
                                                    </span>
                                                )}
                                            {file.removed !== null &&
                                                file.removed > 0 && (
                                                    <span className="text-red-700 dark:text-red-400">
                                                        −{file.removed}
                                                    </span>
                                                )}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Hoàn tác ${file.path}`}
                                        title="Hoàn tác thay đổi"
                                        onClick={() => void discard(file)}
                                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    >
                                        <Undo2
                                            aria-hidden="true"
                                            className="size-4"
                                        />
                                    </button>
                                    {file.status !== 'D' && (
                                        <button
                                            type="button"
                                            aria-label={`Mở ${file.path}`}
                                            title="Mở tệp"
                                            onClick={() =>
                                                onOpenFile(file.path)
                                            }
                                            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                        >
                                            <ArrowUpRight
                                                aria-hidden="true"
                                                className="size-4"
                                            />
                                        </button>
                                    )}
                                </div>
                            </FileContextMenu>
                            {expanded && (
                                <ChangeDiff root={root} change={file} />
                            )}
                        </li>
                    );
                })}
            </ul>
        </>
    );
}

/** * One file's diff against `HEAD`: loaded when the row opens, only the changed lines with a little context around them. */
function ChangeDiff({ root, change }: { root: string; change: Change }) {
    const [sides, setSides] = useState<{
        before: string;
        after: string;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const mime = mediaMime(change.path);

    useEffect(() => {
        if (mime !== null) {
            return;
        }

        let cancelled = false;

        const head = api
            .get<{ content: string }>('/ai-chat/local/head', {
                params: { root, path: change.path },
            })
            .then(({ data }) => data.content);
        const current =
            change.status === 'D'
                ? Promise.resolve('')
                : api
                      .get<{ content?: string }>('/ai-chat/local/file', {
                          params: { root, path: change.path },
                      })
                      .then(({ data }) => data.content ?? '');

        Promise.all([head, current])
            .then(([before, after]) => {
                if (!cancelled) {
                    setSides({ before, after });
                }
            })
            .catch((caught) => {
                if (!cancelled) {
                    setError(
                        requestErrorMessage(caught, 'Không xem được thay đổi.'),
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [root, change.path, change.status, mime]);

    if (mime !== null) {
        return (
            <MediaPreview
                path={change.path}
                mime={mime}
                deleted={change.status === 'D'}
            />
        );
    }

    if (error !== null) {
        return (
            <p role="alert" className="px-4 py-3 text-xs text-destructive">
                {error}
            </p>
        );
    }

    if (sides === null) {
        return <LoadingRows rows={3} className="border-t px-4 py-3" />;
    }

    return (
        <div className="animate-in border-t duration-200 fade-in motion-reduce:animate-none">
            <UnifiedDiff before={sides.before} after={sides.after} />
        </div>
    );
}

/** * A changed picture or PDF: shown as it is now (a text diff of its bytes would say nothing). */
function MediaPreview({
    path,
    mime,
    deleted,
}: {
    path: string;
    mime: string;
    deleted: boolean;
}) {
    const [source, setSource] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (deleted) {
            return;
        }

        let cancelled = false;

        readMedia(path, mime)
            .then((data) => !cancelled && setSource(data))
            .catch((caught) => {
                if (!cancelled) {
                    setError(
                        typeof caught === 'string'
                            ? caught
                            : 'Không xem được tệp này.',
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [path, mime, deleted]);

    if (deleted) {
        return (
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                Tệp đã bị xoá.
            </p>
        );
    }

    if (error !== null) {
        return (
            <p
                role="alert"
                className="border-t px-4 py-3 text-xs text-destructive"
            >
                {error}
            </p>
        );
    }

    if (source === null) {
        return <LoadingRows rows={3} className="border-t px-4 py-3" />;
    }

    return (
        <div className="flex justify-center border-t p-4">
            {isPdfSource(source) ? (
                <iframe
                    src={source}
                    title={path}
                    className="h-96 w-full border-0"
                />
            ) : (
                <img
                    src={source}
                    alt={path}
                    className="max-h-80 max-w-full rounded-md border object-contain"
                />
            )}
        </div>
    );
}
