import { t } from '@/lib/i18n';
import {
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useLocalChanges } from '@/components/ai-chat/local-changes';
import { api } from '@/lib/api';
import { ide } from '@/lib/ide';
import { cachedRequest, forgetRequest } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import type { AiChatProposal } from '@/types';
import { buildTree, parentDirectories } from './tree';

/** * The project's file tree: the paths (GitHub or local), the AI's and git's change marks, the filter and which folders are open. */
export function useFileTree({
    repo,
    branch,
    localRoot,
    changes,
}: {
    repo: string;
    branch: string | null;
    localRoot: string | null;
    changes: AiChatProposal[];
}) {
    const [paths, setPaths] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    // * Bumped to read the tree again (after a file was renamed).
    const [reloads, setReloads] = useState(0);
    const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
    // * Folders already read from disk (cleared whenever the root is read again).
    const loadedRef = useRef(new Set<string>());
    const openDirsRef = useRef(openDirs);

    useEffect(() => {
        openDirsRef.current = openDirs;
    }, [openDirs]);

    // * Every folder is read from disk the first time it is opened (its row is a `dir/` entry until then).
    const loadFolder = useCallback(
        (folder: string) => {
            if (!localRoot || loadedRef.current.has(folder)) {
                return Promise.resolve();
            }

            loadedRef.current.add(folder);

            return ide
                .listDirectory(folder, localRoot)
                .then((children) =>
                    setPaths((current) =>
                        (current ?? [])
                            .filter((path) => path !== `${folder}/`)
                            .concat(children),
                    ),
                )
                .catch(() => {
                    loadedRef.current.delete(folder);
                });
        },
        [localRoot],
    );

    useEffect(() => {
        let cancelled = false;

        // * "local:{id}" is a folder of this machine (read-only here); anything else is a GitHub repo.
        // * The tree of a repo is fetched once and kept a few minutes: closing and reopening the viewer, or switching tabs, does not refetch it.
        const request = cachedRequest(
            `tree.${repo}.${branch ?? ''}`,
            localRoot ? 30_000 : 5 * 60 * 1000,
            () =>
                (localRoot
                    ? api.get<{ paths: string[] }>('/ai-chat/local/tree', {
                          params: { root: localRoot },
                      })
                    : api.get<{ paths: string[] }>('/ai-chat/github/tree', {
                          params: { repo, ...(branch ? { branch } : {}) },
                      })
                ).then(({ data }) => data.paths),
        );

        request
            .then((rows) => {
                if (cancelled) {
                    return;
                }

                // * The root was read again: folders that are open are read again too, parents first.
                loadedRef.current.clear();
                setPaths(rows);
                [...openDirsRef.current]
                    .sort((a, b) => a.length - b.length)
                    .reduce<Promise<void>>(
                        (chain, folder) => chain.then(() => loadFolder(folder)),
                        Promise.resolve(),
                    )
                    .catch(() => undefined);
            })
            .catch((caught) => {
                if (!cancelled) {
                    setPaths([]);
                    setError(
                        requestErrorMessage(
                            caught,
                            t('use_file_tree.could_not_load_the'),
                        ),
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [repo, localRoot, branch, reloads, loadFolder]);

    const changed = useMemo(
        () =>
            new Map(
                changes
                    .filter(
                        (change) =>
                            change.repo === repo &&
                            change.status !== 'rejected',
                    )
                    .map((change) => [change.path, change] as const),
            ),
        [changes, repo],
    );
    const localChanges = useLocalChanges(localRoot);
    // * What the tree marks: the AI's edits plus (local projects) every file git sees as modified or new.
    const changedActions = useMemo(() => {
        const marks = new Map<string, AiChatProposal['action']>();

        localChanges.files?.forEach((file) => {
            if (file.status !== 'D') {
                marks.set(file.path, file.status === 'A' ? 'create' : 'update');
            }
        });
        changed.forEach((change, path) => marks.set(path, change.action));

        return marks;
    }, [changed, localChanges.files]);
    // * Every folder that holds a marked file shows a dot, so a change is visible even in a closed folder.
    const changedDirs = useMemo(
        () => parentDirectories(changedActions.keys()),
        [changedActions],
    );
    // * New files the AI proposes are not in the repo's tree yet: add them so they show up too.
    const allPaths = useMemo(() => {
        const known = new Set(paths ?? []);

        return [
            ...(paths ?? []),
            ...[...changed.keys()].filter((path) => !known.has(path)),
        ];
    }, [paths, changed]);

    // * Deferred: typing stays instant while the tree catches up (it can hold thousands of paths).
    const query = useDeferredValue(filter.trim().toLowerCase());
    const matching = useMemo(
        () =>
            query === ''
                ? allPaths
                : allPaths.filter((path) => path.toLowerCase().includes(query)),
        [allPaths, query],
    );
    const tree = useMemo(() => buildTree(matching), [matching]);
    // * While filtering, every folder with a match is shown open.
    const effectiveOpen = useMemo(
        () => (query === '' ? openDirs : parentDirectories(matching)),
        [openDirs, matching, query],
    );

    const toggleDir = useCallback(
        (path: string) => {
            void loadFolder(path);

            setOpenDirs((current) => {
                const next = new Set(current);

                if (!next.delete(path)) {
                    next.add(path);
                }

                return next;
            });
        },
        [loadFolder],
    );

    /** Closes every folder of the tree. */
    const collapseAll = useCallback(() => setOpenDirs(new Set()), []);

    /** Reads the project's files again. */
    const reload = useCallback(() => {
        forgetRequest(`tree.${repo}.${branch ?? ''}`);
        setReloads((count) => count + 1);
    }, [repo, branch]);

    /** Opens every folder above `path`, reading the ones not read yet, so the file shows in the tree. */
    const revealPath = useCallback(
        (path: string) => {
            const folders = [...parentDirectories([path])].sort(
                (a, b) => a.length - b.length,
            );

            // * Parents first: a folder's row only exists once its parent was read.
            void folders
                .reduce<Promise<void>>(
                    (chain, folder) => chain.then(() => loadFolder(folder)),
                    Promise.resolve(),
                )
                .then(() => undefined);
            setOpenDirs((current) =>
                folders.every((folder) => current.has(folder))
                    ? current
                    : new Set([...current, ...folders]),
            );
        },
        [loadFolder],
    );

    return {
        reload,
        collapseAll,
        revealPath,
        paths,
        error,
        filter,
        setFilter,
        changed,
        localChanges,
        changedActions,
        changedDirs,
        tree,
        effectiveOpen,
        toggleDir,
    };
}
