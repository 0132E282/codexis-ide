import {
    ChevronDown,
    ChevronRight,
    GitCommitHorizontal,
    X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiffView } from '@/components/ai-chat/diff-view';
import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { InputSelect } from '@/components/ui/input-select';
import { onAiChatCacheInvalidated } from '@/lib/ai-chat-cache';
import { parseDiff } from '@/lib/diff-parser';
import { getLanguage, t } from '@/lib/i18n';
import { ide } from '@/lib/ide';
import type {
    GitBranchCompare,
    GitBranchesInfo,
    GitCommit,
    GitCommitFile,
    GitFileDiff,
} from '@/lib/ide';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;
// * Fixed row height (px) so the list can show only the rows in view.
const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 6;
const LOAD_MORE_DISTANCE = 400;
const FILTER_DELAY_MS = 150;
const MAX_CACHED_DIFFS = 60;

type CachedPage = { commits: GitCommit[]; hasMore: boolean };

// * Kept for the session so closing, reopening or switching the tab shows the last list at once while a fresh one is read; commits, their files and diffs never change once made, so only the lists and the branch data are dropped when a checkout, merge or pull happens.
const pageCache = new Map<string, CachedPage>();
const branchesCache = new Map<string, GitBranchesInfo>();
const compareCache = new Map<string, GitBranchCompare>();
const filesCache = new Map<string, GitCommitFile[]>();
const diffCache = new Map<string, GitFileDiff>();
const invalidationSubscribers = new Set<() => void>();

onAiChatCacheInvalidated((prefix) => {
    if (!prefix.startsWith('branches:local:')) {
        return;
    }

    pageCache.clear();
    branchesCache.clear();
    compareCache.clear();
    invalidationSubscribers.forEach((subscriber) => subscriber());
});

function rememberDiff(key: string, value: GitFileDiff) {
    diffCache.delete(key);
    diffCache.set(key, value);

    if (diffCache.size > MAX_CACHED_DIFFS) {
        diffCache.delete(diffCache.keys().next().value as string);
    }
}
const NOT_REPOSITORY = 'git.not_repository';
const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
];

function formatRelativeTime(timestamp: number): string {
    const seconds = timestamp - Date.now() / 1000;
    const formatter = new Intl.RelativeTimeFormat(getLanguage(), {
        numeric: 'auto',
    });

    for (const [unit, size] of TIME_UNITS) {
        if (Math.abs(seconds) >= size) {
            return formatter.format(Math.round(seconds / size), unit);
        }
    }

    return formatter.format(0, 'second');
}

function describeError(error: unknown): string {
    return typeof error === 'string' ? error : t('common.something_went_wrong');
}

/** What one request of the pane is doing: nothing yet, running, done, or failed with the backend's message. */
type Request<Value> =
    | { state: 'loading' }
    | { state: 'done'; value: Value }
    | { state: 'failed'; message: string };

const REF_STYLE: Record<string, string> = {
    head: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
    local: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    remote: 'bg-violet-500/20 text-violet-700 dark:text-violet-300',
    tag: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
};

const NOREPLY_EMAIL = /^(?:(\d+)\+)?([^@+\s]+)@users\.noreply\.github\.com$/i;

/** Login and numeric id (when the email has one) of a GitHub noreply email; null for any other email. */
function parseGithubAuthor(
    email: string,
): { login: string; id: string | undefined } | null {
    const match = NOREPLY_EMAIL.exec(email.trim());

    return match === null ? null : { id: match[1], login: match[2] };
}

/** GitHub avatar address of a commit author, or null when the email is not a GitHub one. */
function getGithubAvatarUrl(email: string): string | null {
    const author = parseGithubAuthor(email);

    if (author === null) {
        return null;
    }

    return author.id !== undefined
        ? `https://avatars.githubusercontent.com/u/${author.id}?s=40`
        : `https://github.com/${author.login}.png?size=40`;
}

/** The author's GitHub picture, or the first letter of the name when the email is not a GitHub one or the picture fails to load. */
function CommitAvatar({ name, email }: { name: string; email: string }) {
    const url = getGithubAvatarUrl(email);
    const [failed, setFailed] = useState(false);

    if (url !== null && !failed) {
        return (
            <img
                src={url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
                className="size-5 shrink-0 rounded-full bg-zinc-300 object-cover dark:bg-zinc-700"
            />
        );
    }

    return (
        <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-medium uppercase dark:bg-zinc-700"
        >
            {name.charAt(0) || <GitCommitHorizontal className="size-3" />}
        </span>
    );
}

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
function CommitFiles({ root, hash }: { root: string; hash: string }) {
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
            <p className="py-1 pl-9 text-xs text-muted-foreground">
                {t('history.files_loading')}
            </p>
        );
    }

    if (request.state === 'failed') {
        return (
            <p role="alert" className="py-1 pl-9 text-xs text-destructive">
                {t('history.error', { message: request.message })}
            </p>
        );
    }

    if (request.value.length === 0) {
        return (
            <p className="py-1 pl-9 text-xs text-muted-foreground">
                {t('history.no_files')}
            </p>
        );
    }

    return (
        <ul aria-label={t('history.files_label')} className="pb-1 pl-9">
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

/** One commit row. Memoized: scrolling or typing in the filter re-renders only the rows whose props changed. */
const CommitRow = memo(function CommitRow({
    commit,
    isOpen,
    onToggle,
}: {
    commit: GitCommit;
    isOpen: boolean;
    onToggle: (hash: string) => void;
}) {
    return (
        <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => onToggle(commit.hash)}
            style={{ height: ROW_HEIGHT }}
            className={cn(
                'flex w-full items-center gap-2 px-2 text-left hover:bg-zinc-200/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-zinc-800/60',
                isOpen && 'bg-zinc-200/60 dark:bg-zinc-800/60',
            )}
        >
            {isOpen ? (
                <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
                <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                />
            )}
            <CommitAvatar
                key={commit.authorEmail}
                name={commit.authorName}
                email={commit.authorEmail}
            />
            <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
            {commit.refs.map((ref) => (
                <span
                    key={`${ref.kind}:${ref.name}`}
                    className={cn(
                        'shrink-0 rounded px-1.5 py-px text-[10px] font-medium',
                        REF_STYLE[ref.kind],
                    )}
                >
                    {ref.name}
                </span>
            ))}
            <span
                title={commit.authorName}
                className="max-w-32 shrink-0 truncate text-muted-foreground"
            >
                {parseGithubAuthor(commit.authorEmail)?.login ??
                    commit.authorName}
            </span>
            <span className="w-24 shrink-0 text-right text-muted-foreground">
                {formatRelativeTime(commit.timestamp)}
            </span>
            <code className="w-14 shrink-0 text-muted-foreground">
                {commit.shortHash}
            </code>
        </button>
    );
});

/** Git history of the project (or of one file): branch picker, filter, the commits (only the rows in view are drawn), and each commit's files and diffs. */
export function GitHistoryPane({
    root,
    filePath,
    onClearFile,
}: {
    /** Folder of the open project. */
    root: string | undefined;
    /** The file the history is limited to (null: the whole branch). */
    filePath: string | null;
    onClearFile: () => void;
}) {
    const [branches, setBranches] = useState<GitBranchesInfo | null>(
        () => (root === undefined ? null : branchesCache.get(root)) ?? null,
    );
    // * null follows the current branch.
    const [branch, setBranch] = useState<string | null>(null);
    const [compare, setCompare] = useState<GitBranchCompare | null>(null);
    const [commits, setCommits] = useState<GitCommit[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filterInput, setFilterInput] = useState('');
    const [filter, setFilter] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);
    // * Height of what the open commit shows under its row, measured; the list keeps it to place the rows below.
    const [expandedExtra, setExpandedExtra] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    // * Bumped when a checkout, merge or pull dropped the caches: the lists are read again.
    const [refreshTick, setRefreshTick] = useState(0);
    // * Bumped on every new query so a slow answer of an earlier one is dropped.
    const generation = useRef(0);
    const scroller = useRef<HTMLDivElement>(null);
    const expandedObserver = useRef<ResizeObserver | null>(null);

    useEffect(() => {
        const refresh = () => setRefreshTick((tick) => tick + 1);

        invalidationSubscribers.add(refresh);

        return () => void invalidationSubscribers.delete(refresh);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(
            () => setFilter(filterInput),
            FILTER_DELAY_MS,
        );

        return () => window.clearTimeout(timer);
    }, [filterInput]);

    useEffect(() => {
        if (root === undefined) {
            return;
        }

        let current = true;

        // * Shown from the cache at once, then replaced by what git says now.
        setBranches(branchesCache.get(root) ?? null);
        ide.gitBranchesInfo(root).then(
            (info) => {
                branchesCache.set(root, info);

                if (current) {
                    setBranches(info);
                }
            },
            () => current && setBranches(null),
        );

        return () => {
            current = false;
        };
    }, [root, refreshTick]);

    const fetchPage = useCallback(
        (skip: number) => {
            if (filePath !== null) {
                return ide.gitFileHistory(filePath, PAGE_SIZE, skip, root);
            }

            return ide.gitLog(branch, PAGE_SIZE, skip, root);
        },
        [root, branch, filePath],
    );
    const pageKey = `${root}\n${filePath ?? ''}\n${branch ?? ''}`;

    useEffect(() => {
        if (root === undefined) {
            return;
        }

        const own = ++generation.current;
        const cached = pageCache.get(pageKey);

        setError(null);
        setExpanded(null);

        // * Stale-while-revalidate: the cached list is shown now and read again in the background.
        if (cached === undefined) {
            setLoading(true);
        } else {
            setCommits(cached.commits);
            setHasMore(cached.hasMore);
            setLoading(false);
        }

        fetchPage(0).then(
            (page) => {
                if (own !== generation.current) {
                    return;
                }

                const more = page.length === PAGE_SIZE;
                const unchanged =
                    cached !== undefined &&
                    page.every(
                        (commit, index) =>
                            cached.commits[index]?.hash === commit.hash,
                    );

                if (!unchanged) {
                    pageCache.set(pageKey, { commits: page, hasMore: more });
                    setCommits(page);
                    setHasMore(more);
                }

                setLoading(false);
            },
            (failure: unknown) => {
                if (own === generation.current) {
                    setCommits([]);
                    setHasMore(false);
                    setError(describeError(failure));
                    setLoading(false);
                }
            },
        );
    }, [root, fetchPage, pageKey, refreshTick]);

    const currentBranch = branches?.current ?? null;

    useEffect(() => {
        if (
            root === undefined ||
            branch === null ||
            currentBranch === null ||
            branch === currentBranch
        ) {
            setCompare(null);

            return;
        }

        const compareKey = `${root}\n${currentBranch}\n${branch}`;
        const cached = compareCache.get(compareKey);

        // * One request per pair of branches until a checkout, merge or pull.
        if (cached !== undefined) {
            setCompare(cached);

            return;
        }

        let current = true;

        ide.gitBranchCompare(currentBranch, branch, root).then(
            (result) => {
                compareCache.set(compareKey, result);

                if (current) {
                    setCompare(result);
                }
            },
            () => current && setCompare(null),
        );

        return () => {
            current = false;
        };
    }, [root, branch, currentBranch]);

    const loadMore = useCallback(() => {
        const own = generation.current;

        setLoadingMore(true);
        fetchPage(commits.length).then(
            (page) => {
                if (own === generation.current) {
                    const all = [...commits, ...page];
                    const more = page.length === PAGE_SIZE;

                    pageCache.set(pageKey, { commits: all, hasMore: more });
                    setCommits(all);
                    setHasMore(more);
                    setLoadingMore(false);
                }
            },
            (failure: unknown) => {
                if (own === generation.current) {
                    setError(describeError(failure));
                    setLoadingMore(false);
                }
            },
        );
    }, [fetchPage, commits, pageKey]);

    const branchOptions = useMemo(
        () =>
            [...(branches?.local ?? []), ...(branches?.remotes ?? [])].map(
                (name) => ({ value: name, label: name }),
            ),
        [branches],
    );

    const visibleCommits = useMemo(() => {
        const needle = filter.trim().toLowerCase();

        return needle === ''
            ? commits
            : commits.filter(
                  (commit) =>
                      commit.subject.toLowerCase().includes(needle) ||
                      commit.authorName.toLowerCase().includes(needle) ||
                      (parseGithubAuthor(commit.authorEmail)?.login ?? '')
                          .toLowerCase()
                          .includes(needle),
              );
    }, [commits, filter]);

    const toggleCommit = useCallback(
        (hash: string) =>
            setExpanded((current) => (current === hash ? null : hash)),
        [],
    );

    useEffect(() => {
        const element = scroller.current;

        if (element === null) {
            return;
        }

        const observer = new ResizeObserver(() =>
            setViewportHeight(element.clientHeight),
        );

        observer.observe(element);
        setViewportHeight(element.clientHeight);

        return () => observer.disconnect();
    }, [root]);

    // * Keeps `expandedExtra` equal to the height of the block under the open commit's row.
    const measureExpanded = useCallback((element: HTMLDivElement | null) => {
        expandedObserver.current?.disconnect();
        expandedObserver.current = null;

        if (element === null) {
            return;
        }

        const observer = new ResizeObserver(() =>
            setExpandedExtra(element.offsetHeight),
        );

        observer.observe(element);
        setExpandedExtra(element.offsetHeight);
        expandedObserver.current = observer;
    }, []);

    const onScroll = () => {
        const element = scroller.current;

        if (element === null) {
            return;
        }

        setScrollTop(element.scrollTop);

        const distanceToEnd =
            element.scrollHeight - element.scrollTop - element.clientHeight;

        if (hasMore && !loadingMore && distanceToEnd < LOAD_MORE_DISTANCE) {
            loadMore();
        }
    };

    if (root === undefined) {
        return null;
    }

    const notRepository = error === NOT_REPOSITORY;

    // * Windowing: rows are ROW_HEIGHT tall, except that the open commit also shows its files and diff (`expandedExtra`) under its row.
    const openIndex =
        expanded === null
            ? -1
            : visibleCommits.findIndex((commit) => commit.hash === expanded);
    const extra = openIndex >= 0 ? expandedExtra : 0;
    const offsetOf = (index: number) =>
        index * ROW_HEIGHT + (openIndex >= 0 && index > openIndex ? extra : 0);
    const indexAt = (position: number) => {
        const y = Math.max(0, position);

        if (openIndex < 0 || y < (openIndex + 1) * ROW_HEIGHT) {
            return Math.floor(y / ROW_HEIGHT);
        }

        if (y < (openIndex + 1) * ROW_HEIGHT + extra) {
            return openIndex;
        }

        return (
            openIndex +
            1 +
            Math.floor((y - (openIndex + 1) * ROW_HEIGHT - extra) / ROW_HEIGHT)
        );
    };
    const first = Math.max(0, indexAt(scrollTop - OVERSCAN_ROWS * ROW_HEIGHT));
    const last = Math.min(
        visibleCommits.length,
        indexAt(scrollTop + viewportHeight + OVERSCAN_ROWS * ROW_HEIGHT) + 1,
    );
    const totalHeight = offsetOf(visibleCommits.length);

    return (
        <div className="flex h-full min-h-0 flex-col text-xs">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1">
                {filePath === null && branchOptions.length > 0 && (
                    <>
                        <InputSelect
                            options={branchOptions}
                            value={branch ?? currentBranch}
                            placeholder={t('history.branch')}
                            className="h-7 w-44"
                            onChange={(value) =>
                                setBranch(
                                    value === currentBranch ? null : value,
                                )
                            }
                        />
                        {compare !== null && (
                            <span
                                title={t('history.ahead_behind', {
                                    ahead: compare.ahead,
                                    behind: compare.behind,
                                })}
                                className="text-muted-foreground tabular-nums"
                            >
                                ↑{compare.ahead} ↓{compare.behind}
                            </span>
                        )}
                    </>
                )}
                {filePath !== null && (
                    <span className="flex max-w-full min-w-0 items-center gap-1 rounded-full bg-zinc-200 py-0.5 pr-1 pl-2 dark:bg-zinc-800">
                        <span className="truncate">
                            {t('history.file_chip', { path: filePath })}
                        </span>
                        <button
                            type="button"
                            aria-label={t('history.clear_file')}
                            title={t('history.clear_file')}
                            onClick={onClearFile}
                            className="rounded-full p-0.5 hover:bg-zinc-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-zinc-700"
                        >
                            <X aria-hidden="true" className="size-3" />
                        </button>
                    </span>
                )}
                <Field
                    name="history-filter"
                    className="ml-auto w-56 min-w-0"
                    value={filterInput}
                    placeholder={t('history.filter')}
                    aria-label={t('history.filter')}
                    autoComplete="off"
                    onChange={(event) => setFilterInput(event.target.value)}
                />
            </div>
            <div
                ref={scroller}
                onScroll={onScroll}
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {loading && (
                    <p className="px-3 py-2 text-muted-foreground">
                        {t('history.loading')}
                    </p>
                )}
                {!loading && notRepository && (
                    <p className="px-3 py-2 text-muted-foreground">
                        {t('history.not_repository')}
                    </p>
                )}
                {!loading && error !== null && !notRepository && (
                    <p role="alert" className="px-3 py-2 text-destructive">
                        {t('history.error', { message: error })}
                    </p>
                )}
                {!loading && error === null && commits.length === 0 && (
                    <p className="px-3 py-2 text-muted-foreground">
                        {t('history.empty')}
                    </p>
                )}
                {!loading &&
                    commits.length > 0 &&
                    visibleCommits.length === 0 && (
                        <p className="px-3 py-2 text-muted-foreground">
                            {t('history.no_match')}
                        </p>
                    )}
                <ul
                    style={{
                        paddingTop: offsetOf(first),
                        paddingBottom: Math.max(
                            0,
                            totalHeight - offsetOf(last),
                        ),
                    }}
                >
                    {visibleCommits.slice(first, last).map((commit) => {
                        const isOpen = expanded === commit.hash;

                        return (
                            <li key={commit.hash}>
                                <CommitRow
                                    commit={commit}
                                    isOpen={isOpen}
                                    onToggle={toggleCommit}
                                />
                                {isOpen && (
                                    <div ref={measureExpanded}>
                                        <CommitFiles
                                            root={root}
                                            hash={commit.hash}
                                        />
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
                {hasMore && (
                    <div className="p-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loadingMore}
                            onClick={loadMore}
                        >
                            {loadingMore
                                ? t('history.loading')
                                : t('history.load_more')}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
