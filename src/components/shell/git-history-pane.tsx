import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Field } from '@/components/form';
import {
    NOT_REPOSITORY,
    branchesCache,
    compareCache,
    describeError,
    invalidationSubscribers,
    pageCache,
} from '@/components/shell/git-history-cache';
import { CommitFiles } from '@/components/shell/git-history-commit-files';
import {
    CommitRow,
    isProfileAuthor,
    ROW_HEIGHT,
    parseGithubAuthor,
} from '@/components/shell/git-history-commit-row';
import { Button } from '@/components/ui/button';
import { InputSelect } from '@/components/ui/input-select';
import { ideAuth } from '@/lib/ide-auth';
import type { GithubProfile } from '@/lib/ide-auth';
import { t } from '@/lib/i18n';
import { ide } from '@/lib/ide';
import type { GitBranchCompare, GitBranchesInfo, GitCommit } from '@/lib/ide';

const PAGE_SIZE = 50;
const OVERSCAN_ROWS = 6;
const LOAD_MORE_DISTANCE = 400;
const FILTER_DELAY_MS = 150;

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
    // * Signed-in GitHub profile: its picture stands in for commits of that person whose email is not a GitHub one.
    const [profile, setProfile] = useState<GithubProfile | null>(null);
    // * Bumped on every new query so a slow answer of an earlier one is dropped.
    const generation = useRef(0);
    const scroller = useRef<HTMLDivElement>(null);
    const expandedObserver = useRef<ResizeObserver | null>(null);

    useEffect(() => {
        ideAuth
            .githubProfile()
            .then(setProfile)
            .catch(() => setProfile(null));
    }, []);

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
                    className="max-w-5xl min-w-0"
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
                                    ownAvatar={
                                        profile !== null &&
                                        isProfileAuthor(commit, profile)
                                            ? profile.avatar
                                            : ''
                                    }
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
