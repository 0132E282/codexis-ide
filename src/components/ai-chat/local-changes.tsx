import { ArrowUpRight, Undo2 } from 'lucide-react';
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
import { t } from '@/lib/i18n';

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
                                t('local_changes.could_not_load_the'),
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
    // * The file whose diff fills the lower half; the first of the list until one is picked (or when the picked one is gone).
    const [picked, setPicked] = useState<string | null>(null);
    const selected = files?.find((file) => file.path === picked) ?? files?.[0];

    const { confirm, dialog } = useConfirm();

    // * Puts the file back as git `HEAD` has it (a new file is removed); asks first, since the edits are lost.
    const discard = async (file: Change) => {
        if (
            !(await confirm({
                title: t('local_changes.discard_changes'),
                description: t('local_changes.discard_all_changes_to', {
                    path: file.path,
                }),
                action: t('local_changes.discard'),
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
            toast.success(
                t('local_changes.discarded_path', { path: file.path }),
            );
            refresh();
        } catch (caught) {
            toast.error(
                requestErrorMessage(
                    caught,
                    t('local_changes.could_not_discard_changes'),
                ),
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
                {t('local_changes.this_folder_is_not')}
            </p>
        );
    }

    if (files.length === 0) {
        return (
            <p className="m-4 text-sm text-muted-foreground">
                {t('local_changes.no_changes_since_the')}
            </p>
        );
    }

    return (
        <>
            {dialog}
            <ul className="max-h-[40%] min-h-16 shrink-0 animate-in overflow-auto border-b duration-200 fade-in motion-reduce:animate-none">
                {files.map((file) => {
                    const name = file.path.split('/').pop() ?? file.path;
                    const dir = file.path.split('/').slice(0, -1).join('/');
                    const isSelected = selected?.path === file.path;

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
                                        label: t('local_changes.show_changes'),
                                        onSelect: () => setPicked(file.path),
                                    },
                                    {
                                        label: t('common.open_file'),
                                        disabled: file.status === 'D',
                                        onSelect: () => onOpenFile(file.path),
                                    },
                                    {
                                        label: t(
                                            'local_changes.discard_changes',
                                        ),
                                        onSelect: () => void discard(file),
                                    },
                                ]}
                            >
                                <div
                                    className={cn(
                                        'flex items-center gap-1 pr-2 hover:bg-accent/50',
                                        isSelected && 'bg-accent/60',
                                    )}
                                >
                                    <button
                                        type="button"
                                        aria-pressed={isSelected}
                                        onClick={() => setPicked(file.path)}
                                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    >
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
                                        aria-label={t(
                                            'local_changes.discard_path',
                                            {
                                                path: file.path,
                                            },
                                        )}
                                        title={t(
                                            'local_changes.discard_changes',
                                        )}
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
                                            aria-label={t(
                                                'local_changes.open_path',
                                                {
                                                    path: file.path,
                                                },
                                            )}
                                            title={t('common.open_file')}
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
                        </li>
                    );
                })}
            </ul>
            <div className="min-h-0 flex-1 overflow-auto">
                {selected !== undefined && (
                    <ChangeDiff
                        key={selected.path}
                        root={root}
                        change={selected}
                    />
                )}
            </div>
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
                        requestErrorMessage(
                            caught,
                            t('local_changes.could_not_view_the'),
                        ),
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
                            : t('local_changes.could_not_view_this'),
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
                {t('local_changes.the_file_was_deleted')}
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
