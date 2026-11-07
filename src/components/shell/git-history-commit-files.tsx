import { useEffect, useMemo, useState } from 'react';
import { DiffView } from '@/components/ai-chat/diff-view';
import {
    diffCache,
    describeError,
    filesCache,
    rememberDiff,
    type Request,
} from '@/components/shell/git-history-cache';
import { parseDiff } from '@/lib/diff-parser';
import { t } from '@/lib/i18n';
import { ide } from '@/lib/ide';
import type { GitCommitFile, GitFileDiff } from '@/lib/ide';

/** The diff of one file of one commit. */
function FileDiffView({
    root,
    hash,
    path,
}: {
    root: string;
    hash: string;
    path: string;
}) {
    const cacheKey = `${root}\n${hash}\n${path}`;
    const [request, setRequest] = useState<Request<GitFileDiff>>(() => {
        const cached = diffCache.get(cacheKey);

        return cached === undefined
            ? { state: 'loading' }
            : { state: 'done', value: cached };
    });

    useEffect(() => {
        if (diffCache.has(cacheKey)) {
            return;
        }

        let current = true;

        ide.gitCommitFileDiff(hash, path, root).then(
            (value) => {
                rememberDiff(cacheKey, value);

                if (current) {
                    setRequest({ state: 'done', value });
                }
            },
            (error: unknown) =>
                current &&
                setRequest({ state: 'failed', message: describeError(error) }),
        );

        return () => {
            current = false;
        };
    }, [cacheKey, root, hash, path]);

    const rows = useMemo(
        () => (request.state === 'done' ? parseDiff(request.value.diff) : null),
        [request],
    );

    if (request.state === 'loading') {
        return (
            <p className="px-3 py-2 text-xs text-muted-foreground">
                {t('history.diff_loading')}
            </p>
        );
    }

    if (request.state === 'failed') {
        return (
            <p role="alert" className="px-3 py-2 text-xs text-destructive">
                {t('history.error', { message: request.message })}
            </p>
        );
    }

    return (
        <div className="max-h-80 overflow-auto border-t bg-background">
            {request.value.diff.trim() === '' ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                    {t('history.diff_empty')}
                </p>
            ) : rows !== null ? (
                <DiffView rows={rows} />
            ) : (
                <pre className="px-3 py-1 font-mono text-xs whitespace-pre">
                    {request.value.diff}
                </pre>
            )}
            {request.value.truncated && (
                <p className="px-3 py-1 text-xs text-muted-foreground">
                    {t('history.diff_truncated')}
                </p>
            )}
        </div>
    );
}

/** The files one commit changed; picking a file shows its diff under it. */
export function CommitFiles({
    root,
    hash,
    indentClassName = 'pl-9',
}: {
    root: string;
    hash: string;
    indentClassName?: string;
}) {
    const cacheKey = `${root}\n${hash}`;
    const [request, setRequest] = useState<Request<GitCommitFile[]>>(() => {
        const cached = filesCache.get(cacheKey);

        return cached === undefined
            ? { state: 'loading' }
            : { state: 'done', value: cached };
    });
    const [openPath, setOpenPath] = useState<string | null>(null);

    useEffect(() => {
        if (filesCache.has(cacheKey)) {
            return;
        }

        let current = true;

        ide.gitCommitFiles(hash, root).then(
            (value) => {
                filesCache.set(cacheKey, value);

                if (current) {
                    setRequest({ state: 'done', value });
                }
            },
            (error: unknown) =>
                current &&
                setRequest({ state: 'failed', message: describeError(error) }),
        );

        return () => {
            current = false;
        };
    }, [cacheKey, root, hash]);

    if (request.state === 'loading') {
        return (
            <p className={`py-1 ${indentClassName} text-xs text-muted-foreground`}>
                {t('history.files_loading')}
            </p>
        );
    }

    if (request.state === 'failed') {
        return (
            <p role="alert" className={`py-1 ${indentClassName} text-xs text-destructive`}>
                {t('history.error', { message: request.message })}
            </p>
        );
    }

    if (request.value.length === 0) {
        return (
            <p className={`py-1 ${indentClassName} text-xs text-muted-foreground`}>
                {t('history.no_files')}
            </p>
        );
    }

    return (
        <ul aria-label={t('history.files_label')} className={`pb-1 ${indentClassName}`}>
            {request.value.map((file) => (
                <li key={file.path}>
                    <button
                        type="button"
                        aria-expanded={openPath === file.path}
                        onClick={() =>
                            setOpenPath(
                                openPath === file.path ? null : file.path,
                            )
                        }
                        className="flex w-full items-center gap-2 px-2 py-0.5 text-left text-xs hover:bg-zinc-200/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-zinc-800/60"
                    >
                        <span className="w-4 shrink-0 font-mono font-medium text-muted-foreground">
                            {file.status}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                            {file.path}
                        </span>
                        {file.additions !== null && (
                            <span className="shrink-0 text-green-600 tabular-nums">
                                +{file.additions}
                            </span>
                        )}
                        {file.deletions !== null && (
                            <span className="shrink-0 text-red-600 tabular-nums">
                                −{file.deletions}
                            </span>
                        )}
                    </button>
                    {openPath === file.path && (
                        <FileDiffView
                            root={root}
                            hash={hash}
                            path={file.path}
                        />
                    )}
                </li>
            ))}
        </ul>
    );
}
