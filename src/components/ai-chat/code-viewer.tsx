import {
    Check,
    ChevronDown,
    ChevronRight,
    Code2,
    Eye,
    X,
    Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { isPdfSource } from '@/lib/media-file';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { cachedRequest, invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import { QuickOpen } from '@/components/ai-chat/quick-open';
import { CommitActions } from '@/components/ai-chat/commit-box';
import { FileContextMenu } from '@/components/ai-chat/file-context-menu';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { useConfirm } from '@/hooks/use-confirm';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import type { AiChatActivityStep, AiChatProposal } from '@/types';
import { Input } from '@/components/ui/input';
import { LoadingRows } from '@/components/ai-chat/loading-rows';
import {
    LocalChanges,
    useLocalChanges,
} from '@/components/ai-chat/local-changes';
import { firstChangedLine, reconstructOriginal } from '@/lib/proposal-original';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { readSvgFile } from '@/lib/svg-file';
import { cn } from '@/lib/utils';

// * Monaco is heavy: it loads only when a file is opened.
const MonacoCode = lazy(() => import('@/components/ai-chat/monaco-code'));
const MonacoDiff = lazy(() => import('@/components/ai-chat/monaco-diff'));

const CHANGE_BADGES = {
    update: {
        letter: 'M',
        label: 'đã sửa',
        className: 'text-yellow-600 dark:text-yellow-400',
    },
    create: {
        letter: 'A',
        label: 'thêm mới',
        className: 'text-green-600 dark:text-green-400',
    },
} as const;

type TreeNode = {
    name: string;
    path: string;
    children: TreeNode[] | null;
};

const errorText = requestErrorMessage;

// * How often an open local file is checked against the disk (the local file reads share a per-minute budget).
const LIVE_REFRESH_MS = 8000;

// * Folders first, then files, each alphabetically.
function buildTree(paths: string[]): TreeNode[] {
    const root: TreeNode = { name: '', path: '', children: [] };

    for (const path of paths) {
        let node = root;
        const parts = path.split('/');

        parts.forEach((name, index) => {
            const isFile = index === parts.length - 1;
            const nodePath = parts.slice(0, index + 1).join('/');
            let child = node.children?.find((item) => item.name === name);

            if (!child) {
                child = { name, path: nodePath, children: isFile ? null : [] };
                node.children?.push(child);
            }

            node = child;
        });
    }

    const sort = (nodes: TreeNode[]) => {
        nodes.sort(
            (a, b) =>
                Number(b.children !== null) - Number(a.children !== null) ||
                a.name.localeCompare(b.name),
        );
        nodes.forEach((node) => node.children && sort(node.children));
    };

    sort(root.children ?? []);

    return root.children ?? [];
}

function TreeItems({
    nodes,
    depth,
    openDirs,
    onToggle,
    selected,
    onSelect,
    marked,
    onMark,
    changed,
    changedDirs,
    actions,
}: {
    nodes: TreeNode[];
    depth: number;
    openDirs: Set<string>;
    onToggle: (path: string) => void;
    selected: string | null;
    onSelect: (path: string) => void;
    /** * Files picked with Cmd/Ctrl+click (several at once, tagged in the chat). */
    marked: Set<string>;
    onMark: (path: string) => void;
    changed: Map<string, AiChatProposal['action']>;
    changedDirs: Set<string>;
    actions: FileActions;
}) {
    return (
        <ul role={depth === 0 ? 'tree' : 'group'}>
            {nodes.map((node) => {
                const isDir = node.children !== null;
                const isOpen = openDirs.has(node.path);

                return (
                    <li
                        key={node.path}
                        role="treeitem"
                        aria-expanded={isDir ? isOpen : undefined}
                        aria-selected={
                            node.path === selected || marked.has(node.path)
                        }
                    >
                        <FileContextMenu
                            path={node.path}
                            actions={actions}
                            folder={isDir}
                            items={[
                                {
                                    label: isDir
                                        ? isOpen
                                            ? 'Thu gọn'
                                            : 'Mở rộng'
                                        : 'Mở tệp',
                                    onSelect: () =>
                                        isDir
                                            ? onToggle(node.path)
                                            : onSelect(node.path),
                                },
                            ]}
                        >
                            <button
                                type="button"
                                onClick={(event) =>
                                    isDir
                                        ? onToggle(node.path)
                                        : event.metaKey || event.ctrlKey
                                          ? onMark(node.path)
                                          : onSelect(node.path)
                                }
                                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                                className={cn(
                                    'flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                    node.path === selected &&
                                        'bg-accent text-accent-foreground',
                                    marked.has(node.path) &&
                                        'bg-primary/15 text-foreground ring-1 ring-primary/40',
                                )}
                            >
                                {isDir ? (
                                    isOpen ? (
                                        <ChevronDown
                                            aria-hidden="true"
                                            className="size-3.5 shrink-0"
                                        />
                                    ) : (
                                        <ChevronRight
                                            aria-hidden="true"
                                            className="size-3.5 shrink-0"
                                        />
                                    )
                                ) : (
                                    <span className="size-3.5 shrink-0" />
                                )}
                                <FileIcon
                                    name={node.name}
                                    dir={isDir}
                                    open={isOpen}
                                />
                                <span
                                    className={cn(
                                        'truncate',
                                        changed.has(node.path) &&
                                            CHANGE_BADGES[
                                                changed.get(node.path)!
                                            ].className,
                                        // * A folder that holds a changed file is yellow too.
                                        isDir &&
                                            changedDirs.has(node.path) &&
                                            CHANGE_BADGES.update.className,
                                    )}
                                >
                                    {node.name}
                                </span>
                                {isDir && changedDirs.has(node.path) && (
                                    <span
                                        role="img"
                                        aria-label="Có tệp đã thay đổi"
                                        title="Có tệp đã thay đổi"
                                        className="ml-auto size-1.5 shrink-0 rounded-full bg-yellow-500"
                                    />
                                )}
                                {changed.has(node.path) && (
                                    <span
                                        title={`Đã thay đổi (${CHANGE_BADGES[changed.get(node.path)!].label})`}
                                        className={cn(
                                            'ml-auto shrink-0 text-xs font-medium',
                                            CHANGE_BADGES[
                                                changed.get(node.path)!
                                            ].className,
                                        )}
                                    >
                                        {
                                            CHANGE_BADGES[
                                                changed.get(node.path)!
                                            ].letter
                                        }
                                    </span>
                                )}
                            </button>
                        </FileContextMenu>
                        {isDir && isOpen && node.children && (
                            <TreeItems
                                nodes={node.children}
                                depth={depth + 1}
                                openDirs={openDirs}
                                onToggle={onToggle}
                                selected={selected}
                                onSelect={onSelect}
                                marked={marked}
                                onMark={onMark}
                                changed={changed}
                                changedDirs={changedDirs}
                                actions={actions}
                            />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/** * Read-only code viewer of the selected GitHub repo: file tree on the right, the open file with line numbers on the left. */
/**
 * The text while the AI "types" an edit: the untouched head and tail stay as they are, and inside the changed block the new lines replace the old ones one by one (so no file-long red block flashes).
 */
function typedLines(before: string, after: string, shown: number): string {
    const old = before.split('\n');
    const next = after.split('\n');
    let head = 0;

    while (
        head < old.length &&
        head < next.length &&
        old[head] === next[head]
    ) {
        head++;
    }

    let tail = 0;

    while (
        tail < old.length - head &&
        tail < next.length - head &&
        old[old.length - 1 - tail] === next[next.length - 1 - tail]
    ) {
        tail++;
    }

    const typed = Math.max(0, shown - head);

    return [
        ...next.slice(0, head),
        ...next.slice(head, head + typed),
        ...old.slice(head + typed, old.length - tail),
        ...next.slice(next.length - tail),
    ].join('\n');
}

export function CodeViewer({
    repo,
    repos,
    onViewRepo,
    headerActions,
    branch = null,
    changes,
    openRequest = null,
    onAsk,
    onInlineAsk,
    assistant,
    onChangesUpdate,
    aiSelection,
    onActiveFile,
    onEditorVisible,
    onMarkedFiles,
}: {
    /** * The project whose files are shown. */
    repo: string;
    /** * Every project picked for the chat; with more than one the header offers a dropdown to switch. */
    repos: string[];
    onViewRepo: (repo: string) => void;
    /** * Extra buttons in the tree header (branch and Terminal), next to the project name. */
    headerActions?: ReactNode;
    /** * GitHub branch to browse (null: the default one). */
    branch?: string | null;
    /** * Files the AI changed in this conversation (shown with M/A marks and a diff). */
    changes: AiChatProposal[];
    /** * A file to open right away (clicked in an edit proposal of the chat). */
    openRequest?: { repo: string; path: string; id: number } | null;
    /** * The person picked lines and chose "Chat với AI": the chat takes them as a reference. */
    onAsk?: (reference: {
        path: string;
        startLine: number;
        endLine: number;
        text: string;
    }) => void;
    /** * "Chat với AI về đoạn này" answers in a comment box under the lines: asks about them and returns the answer (the same conversation continues with `conversation`). */
    onInlineAsk?: (
        reference: {
            path: string;
            startLine: number;
            endLine: number;
            text: string;
        },
        question: string,
        conversation: string | null,
        signal: AbortSignal,
        onStep: (step: AiChatActivityStep) => void,
        files: File[],
    ) => Promise<InlineAnswer>;
    /** * Name and avatar of the assistant, shown on the answers of the comment box. */
    assistant?: AssistantIdentity;
    /** * The AI account and model picked in the chat: the commit box's "Tạo bằng AI" asks that one. */
    aiSelection?: { accountId: number | null; model: string | null };
    /** * An answer's edits changed state (applied or dropped from the header tick): the page's list of changes follows. */
    onChangesUpdate?: (proposals: AiChatProposal[]) => void;
    /** * The file open in the viewer changed (null: none): the chat tags it by itself. */
    onActiveFile?: (path: string | null) => void;
    /** * Whether the editor column (an open file or the change list) is showing; false leaves its room to the host. */
    onEditorVisible?: (visible: boolean) => void;
    /** * Files picked together with Cmd/Ctrl+click (empty: none): the chat tags all of them. */
    onMarkedFiles?: (paths: string[]) => void;
}) {
    const { copy: copyPath } = useCopyToClipboard();
    // * Either column can be dragged out to the full width: the chat then shrinks away (and clips its content) instead of being pushed off the screen.
    const fileWidth = useResizableWidth(
        'ai-chat.width.file',
        704,
        320,
        window.innerWidth,
    );
    const treeWidth = useResizableWidth(
        'ai-chat.width.tree',
        256,
        180,
        window.innerWidth,
    );
    const localRoot = repo.startsWith('local:') ? repo.slice(6) : null;
    const sourceName = localRoot ? `Máy local · ${localRoot}` : repo;
    const [paths, setPaths] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<string | null>(null);

    useEffect(() => {
        onActiveFile?.(selected);
    }, [selected, onActiveFile]);

    const [marked, setMarked] = useState<Set<string>>(new Set());

    useEffect(() => {
        onMarkedFiles?.([...marked]);
    }, [marked, onMarkedFiles]);
    // * Files open as tabs (the active one is `selected`); an unsaved edit of a tab that is not active waits in `drafts`.
    const [tabs, setTabs] = useState<string[]>([]);
    // * A tab being dragged and the tab it would land on: dropping moves it to that position.
    const [draggedTab, setDraggedTab] = useState<string | null>(null);
    const [dropTab, setDropTab] = useState<string | null>(null);
    const moveTab = (from: string, to: string) =>
        setTabs((current) => {
            const without = current.filter((item) => item !== from);

            without.splice(current.indexOf(to), 0, from);

            return without;
        });
    const drafts = useRef(new Map<string, string>());
    const [content, setContent] = useState<string | null>(null);
    // * The column left of the tree shows the open file, or (local projects) every file that differs from git HEAD.
    const [view, setView] = useState<'files' | 'changes'>('files');
    // * The person's unsaved edit of the open local file (null = none).
    const [draft, setDraft] = useState<string | null>(null);
    // * Where the AI changed the open file: the editor scrolls there (the first changed line of the stored diff).
    // * While an edit the AI just wrote is "typed" into the editor: the text shown (null: the file as it is).
    const [typing, setTyping] = useState<string | null>(null);
    const stopTyping = useRef<() => void>(() => undefined);
    const [revealAt, setRevealAt] = useState<{
        line: number;
        count: number;
        id: number;
    } | null>(null);
    // * The open local file as it is in git HEAD (null: not tracked, or no git): the editor marks the lines that differ.
    const [baseline, setBaseline] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    // * For a changed file: the AI's version, shown as a diff against `content` (the file as it is on the default branch).
    const [proposed, setProposed] = useState<string | null>(null);
    // * For an applied local edit: the file before the edit, rebuilt from the stored diff (the diff's left side).
    const [base, setBase] = useState<string | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);
    // * An image file arrives as a data URL and is shown as a picture instead of text.
    const [image, setImage] = useState<string | null>(null);
    // * A markdown file can be read rendered instead of as code (resets when another file opens).
    const [preview, setPreview] = useState(true);
    const isMarkdown = /\.(md|markdown)$/i.test(selected ?? '');

    useEffect(() => setPreview(true), [selected]);

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
            .then((rows) => !cancelled && setPaths(rows))
            .catch((caught) => {
                if (!cancelled) {
                    setPaths([]);
                    setError(errorText(caught, 'Không tải được cây thư mục.'));
                }
            });

        return () => {
            cancelled = true;
        };
    }, [repo, localRoot, branch]);

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
    const changedDirs = useMemo(() => {
        const dirs = new Set<string>();

        changedActions.forEach((_, path) => {
            const parts = path.split('/');

            parts
                .slice(0, -1)
                .forEach((_part, index) =>
                    dirs.add(parts.slice(0, index + 1).join('/')),
                );
        });

        return dirs;
    }, [changedActions]);
    // * New files the AI proposes are not in the repo's tree yet: add them so they show up too.
    const allPaths = useMemo(
        () => [
            ...(paths ?? []),
            ...[...changed.keys()].filter(
                (path) => !(paths ?? []).includes(path),
            ),
        ],
        [paths, changed],
    );

    // * Another project: its files are not these tabs.
    const shownRepo = useRef(repo);

    useEffect(() => {
        if (shownRepo.current !== repo) {
            shownRepo.current = repo;
            drafts.current.clear();
            setTabs([]);
            setSelected(null);
        }
    }, [repo]);

    const query = filter.trim().toLowerCase();
    const tree = useMemo(
        () =>
            buildTree(
                allPaths.filter((path) => path.toLowerCase().includes(query)),
            ),
        [allPaths, query],
    );
    // * While filtering, every folder with a match is shown open.
    const effectiveOpen = useMemo(() => {
        if (query === '') {
            return openDirs;
        }

        const all = new Set<string>();

        allPaths.forEach((path) => {
            const parts = path.split('/');

            parts
                .slice(0, -1)
                .forEach((_, index) =>
                    all.add(parts.slice(0, index + 1).join('/')),
                );
        });

        return all;
    }, [openDirs, allPaths, query]);

    // * An open local file follows the disk: every few seconds (tab visible, not while a diff is shown) it is read again and replaced only when its text changed.
    const contentRef = useRef<string | null>(null);

    const draftRef = useRef<string | null>(null);

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);

    useEffect(() => {
        if (localRoot === null || selected === null || proposed !== null) {
            return;
        }

        let cancelled = false;
        const timer = window.setInterval(() => {
            // * An unsaved edit is never replaced by the disk's text.
            if (
                document.hidden ||
                contentRef.current === null ||
                draftRef.current !== null
            ) {
                return;
            }

            api.get<{ content?: string; image?: string }>(
                '/ai-chat/local/file',
                { params: { root: localRoot, path: selected } },
            )
                .then(({ data }) => {
                    if (
                        !cancelled &&
                        data.content !== undefined &&
                        data.content !== contentRef.current
                    ) {
                        setContent(data.content);
                    }
                })
                .catch(() => undefined);
        }, LIVE_REFRESH_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [localRoot, selected, proposed]);

    // * Status of the AI's change to the open file when it was loaded: applying it later reloads the file.
    const loadedStatus = useRef<string | undefined>(undefined);
    const selectedStatus =
        selected === null ? undefined : changed.get(selected)?.status;

    useEffect(() => {
        if (
            selected !== null &&
            localRoot !== null &&
            selectedStatus === 'applied' &&
            loadedStatus.current !== 'applied'
        ) {
            void openFile(selected);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStatus]);

    // * Opens the file a proposal pointed at, once per request, as soon as the project's tree is known.
    const handledRequest = useRef<number | null>(null);

    useEffect(() => {
        if (
            openRequest !== null &&
            openRequest.repo === repo &&
            paths !== null &&
            handledRequest.current !== openRequest.id
        ) {
            handledRequest.current = openRequest.id;
            void openFile(openRequest.path);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openRequest, paths, repo]);

    const openFile = async (
        path: string,
        discardCurrent = false,
        fresh?: AiChatProposal[],
    ) => {
        // * Right after a decision the state still holds the old status: the answer's own list is newer.
        const latest =
            fresh?.find((item) => item.repo === repo && item.path === path) ??
            changed.get(path);
        // * An edit that was taken back or dropped no longer shows as a change.
        const change =
            latest?.status === 'reverted' || latest?.status === 'rejected'
                ? undefined
                : latest;

        // * A local edit that is applied is already in the file: show the file itself, not a diff against itself.
        const applied = localRoot !== null && change?.status === 'applied';

        loadedStatus.current = change?.status;

        setTabs((current) =>
            current.includes(path) ? current : [...current, path],
        );
        setView('files');
        setSelected(path);
        stopTyping.current();
        setTyping(null);
        setContent(null);
        setRevealAt(null);
        setDraft(null);
        setBaseline(null);
        setSaveError(null);
        setImage(null);
        setProposed(applied ? null : (change?.content ?? null));
        setBase(null);
        setFileError(null);

        // * A file the AI is creating has no current version to load.
        if (change?.action === 'create' && !applied) {
            setContent('');

            return;
        }

        try {
            // * A file read stays cached for a minute so clicking back and forth does not burn the per-minute budget (a local file may change, so it is not cached).
            const load = () =>
                api
                    .get<{ content?: string; image?: string }>(
                        localRoot
                            ? '/ai-chat/local/file'
                            : '/ai-chat/github/file',
                        {
                            params: localRoot
                                ? { root: localRoot, path }
                                : {
                                      repo,
                                      path,
                                      ...(branch ? { branch } : {}),
                                  },
                        },
                    )
                    .then(({ data }) => data);

            const file = localRoot
                ? await load()
                : await cachedRequest(
                      `file.${repo}.${branch ?? ''}.${path}`,
                      60_000,
                      load,
                  );

            // * The IDE sends text only: an SVG is text, so its sanitised source is shown as an image (raster files fail to read in Rust, see fileError).
            const svg = /\.svg$/i.test(path)
                ? readSvgFile(file.content ?? '')
                : null;

            setImage(
                file.image ??
                    (svg === null
                        ? null
                        : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.safe)}`),
            );
            setContent(file.content ?? '');

            // * An edit the AI just wrote: the editor scrolls to where it changed the file.
            const changedAt =
                applied && change?.diff
                    ? firstChangedLine(file.content ?? '', change.diff)
                    : null;

            setRevealAt(
                changedAt === null ? null : { ...changedAt, id: Date.now() },
            );

            // * The edit is written into the editor line by line (frame-driven), then the real file takes over.
            const before =
                applied && change?.diff && file.content !== undefined
                    ? reconstructOriginal(file.content, change.diff)
                    : null;

            if (
                before !== null &&
                file.content !== undefined &&
                !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ) {
                const after = file.content;
                const total = Math.max(
                    before.split('\n').length,
                    after.split('\n').length,
                );
                const first = changedAt === null ? 0 : changedAt.line - 1;
                const duration = Math.min(
                    3000,
                    Math.max(800, (total - first) * 40),
                );
                const started = performance.now();
                let frame = 0;
                let last = -1;

                const tick = (now: number) => {
                    const due =
                        first +
                        Math.floor(
                            ((now - started) / duration) * (total - first),
                        );

                    if (due >= total) {
                        setTyping(null);

                        return;
                    }

                    if (due !== last) {
                        last = due;
                        setTyping(typedLines(before, after, due));
                    }

                    frame = requestAnimationFrame(tick);
                };

                stopTyping.current = () => {
                    cancelAnimationFrame(frame);
                    setTyping(null);
                };
                setTyping(typedLines(before, after, first));
                frame = requestAnimationFrame(tick);
            }

            const unsaved = drafts.current.get(path);

            if (unsaved !== undefined && unsaved !== file.content) {
                setDraft(unsaved);
            }

            if (localRoot && file.content !== undefined) {
                api.get<{ content: string; tracked: boolean }>(
                    '/ai-chat/local/head',
                    { params: { root: localRoot, path } },
                )
                    .then(({ data }) =>
                        setBaseline(data.tracked ? data.content : null),
                    )
                    .catch(() => setBaseline(null));
            }
        } catch (caught) {
            setFileError(errorText(caught, 'Không mở được tệp.'));
        }
    };

    const save = async () => {
        if (
            localRoot === null ||
            selected === null ||
            content === null ||
            draft === null ||
            saving
        ) {
            return;
        }

        setSaving(true);
        setSaveError(null);

        const written = draft;

        try {
            await api.put('/ai-chat/local/file', {
                root: localRoot,
                path: selected,
                content: written,
                original: content,
            });
            setContent(written);
            // * Typing went on during the request: that newer text stays a draft and is saved next.
            setDraft((current) => (current === written ? null : current));
            if (draftRef.current === written) {
                drafts.current.delete(selected);
            }
        } catch (caught) {
            setSaveError(errorText(caught, 'Không lưu được tệp.'));
        } finally {
            setSaving(false);
        }
    };

    // * Cmd/Ctrl+S anywhere in the page (not only inside the editor): applies the AI's edit when one is waiting, else saves now; the browser's own "save page" never opens.
    const shortcut = useRef<() => void>(() => undefined);

    shortcut.current = () =>
        void (pendingEdit !== undefined ? decideEdit('apply') : save());

    useEffect(() => {
        if (selected === null) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 's'
            ) {
                event.preventDefault();
                shortcut.current();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [selected]);

    // * Writes the typed text of a file that is being left (another file opens, its tab closes). False when it could not be written.
    const persist = async (path: string, text: string | undefined) => {
        if (localRoot === null || text === undefined) {
            return true;
        }

        try {
            await api.put('/ai-chat/local/file', {
                root: localRoot,
                path,
                content: text,
            });

            if (drafts.current.get(path) === text || path !== selected) {
                drafts.current.delete(path);
            }

            return true;
        } catch (caught) {
            toast.error(errorText(caught, `Không lưu được ${path}.`));

            return false;
        }
    };
    const draftOf = (path: string) =>
        path === selected ? (draft ?? undefined) : drafts.current.get(path);

    // * No save button: an edit is written to the file shortly after typing stops.
    const autoSave = useRef(save);

    autoSave.current = save;

    useEffect(() => {
        if (draft === null || saving) {
            return;
        }

        const timer = window.setTimeout(() => void autoSave.current(), 800);

        return () => window.clearTimeout(timer);
    }, [draft, saving]);

    // * Only a plain local text file can be edited; GitHub files and AI proposals stay read-only.
    const editable =
        localRoot !== null &&
        proposed === null &&
        image === null &&
        typing === null;

    const showChanges = localRoot !== null && view === 'changes';
    const editorVisible = selected !== null || showChanges;

    useEffect(() => {
        onEditorVisible?.(editorVisible);
    }, [editorVisible, onEditorVisible]);

    const isDirty = (path: string) =>
        path === selected ? draft !== null : drafts.current.has(path);

    const { confirm, dialog: confirmDialog } = useConfirm();

    const closeTab = async (path: string) => {
        // * Closing the tab saves what was typed; only a failed write asks whether to drop it.
        if (
            isDirty(path) &&
            !(await persist(path, draftOf(path))) &&
            !(await confirm({
                title: 'Đóng tệp chưa lưu',
                description: `${path.split('/').pop()} chưa lưu được. Đóng và bỏ thay đổi?`,
                action: 'Đóng và bỏ',
            }))
        ) {
            return;
        }

        drafts.current.delete(path);
        const index = tabs.indexOf(path);
        const rest = tabs.filter((item) => item !== path);

        setTabs(rest);

        if (path !== selected) {
            return;
        }

        const next = rest[Math.min(index, rest.length - 1)];

        if (next === undefined) {
            setSelected(null);
            setDraft(null);
        } else {
            void openFile(next, true);
        }
    };

    // * The right-click menu of every file row (tree and change list) and of the open-file tabs shares these.
    // * The AI's pending edit of the open file (a local project): the tick in the header writes it, the cross drops it.
    const pendingEdit =
        localRoot !== null && proposed !== null && selected !== null
            ? changes.find(
                  (change) =>
                      change.repo === repo &&
                      change.path === selected &&
                      change.status === 'pending' &&
                      change.message_id !== undefined,
              )
            : undefined;
    // * An edit already written to the file: the same arrow takes it back (revert-local).
    const appliedEdit =
        localRoot !== null && selected !== null
            ? changes.find(
                  (change) =>
                      change.repo === repo &&
                      change.path === selected &&
                      change.status === 'applied' &&
                      change.message_id !== undefined,
              )
            : undefined;
    const boxHost = useRef<HTMLDivElement>(null);
    // * Takes every comment box away (the edit was decided, or another file opens).
    const closeBoxes = () =>
        boxHost.current?.dispatchEvent(new Event('pm-close-boxes'));
    // * A new edit of the AI is "typed" into the diff: its lines show up one burst after another (null: all shown).
    const [revealed, setRevealed] = useState<number | null>(null);
    const pendingId = pendingEdit?.id;

    useEffect(() => {
        const total =
            proposed === null
                ? 0
                : Math.max(
                      proposed.split('\n').length,
                      (base ?? content ?? '').split('\n').length,
                  );

        if (
            pendingId === undefined ||
            total < 2 ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
            setRevealed(null);

            return;
        }

        // * Starts at the first changed line: the untouched head of the file is not "typed".
        const old = (base ?? content ?? '').split('\n');
        const next = (proposed ?? '').split('\n');
        let shown = 0;

        while (
            shown < old.length &&
            shown < next.length &&
            old[shown] === next[shown]
        ) {
            shown++;
        }

        setRevealed(shown);

        // * Frame-driven and time-based (about 25 lines a second, 0.8 to 3 s in all): each frame shows the lines due by now, so the typing flows instead of stepping on a timer.
        const first = shown;
        const duration = Math.min(3000, Math.max(800, (total - first) * 40));
        const started = performance.now();
        let frame = 0;
        let last = first;

        const tick = (now: number) => {
            const due =
                first +
                Math.floor(((now - started) / duration) * (total - first));

            if (due >= total) {
                setRevealed(null);

                return;
            }

            // * Only a line that is new re-renders the diff.
            if (due !== last) {
                last = due;
                setRevealed(due);
            }

            frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(frame);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingId, proposed === null]);
    const [deciding, setDeciding] = useState(false);
    const decideEdit = async (kind: 'apply' | 'reject' | 'revert') => {
        const target = pendingEdit ?? appliedEdit;

        if (target?.message_id === undefined) {
            return;
        }

        setDeciding(true);

        try {
            const { data } = await api.post<{ proposals: AiChatProposal[] }>(
                `/ai-chat/messages/${target.message_id}/proposals/${
                    {
                        apply: 'apply-local',
                        reject: 'reject',
                        revert: 'revert-local?force=1',
                    }[kind]
                }`,
            );

            invalidateAiChatCache(`file.${repo}.`);
            onChangesUpdate?.(data.proposals);
            closeBoxes();

            // * Reopen the file: the written version (or, once dropped, the one on disk).
            if (selected !== null) {
                void openFile(selected, true, data.proposals);
            }
        } catch (caught) {
            toast.error(
                requestErrorMessage(caught, 'Không xử lý được thay đổi này.'),
            );
        } finally {
            setDeciding(false);
        }
    };

    // * Cmd/Ctrl+P: find a file by name (while this viewer is on screen).
    const [quickOpen, setQuickOpen] = useState(false);

    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                !event.shiftKey &&
                !event.altKey &&
                event.key.toLowerCase() === 'p'
            ) {
                event.preventDefault();
                setQuickOpen(true);
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // * Set by the editor: asks about its selection (the whole file when nothing is selected).
    const askTrigger = useRef<(() => void) | null>(null);
    const fileActions: FileActions = {
        copy: (path) => {
            void copyPath(path);
        },
        ask: onAsk
            ? (path) => onAsk({ path, startLine: 0, endLine: 0, text: path })
            : undefined,
    };

    // * Several tabs at once (the tab menu): one confirmation if any has unsaved edits; the open file moves to the nearest tab left.
    const closeTabs = async (paths: string[]) => {
        const gone = new Set(paths);
        // * Each unsaved tab is written first; only the ones that fail ask whether to drop them.
        const results = await Promise.all(
            paths
                .filter(isDirty)
                .map(
                    async (path) =>
                        [path, await persist(path, draftOf(path))] as const,
                ),
        );
        const unsaved = results.filter(([, saved]) => !saved);

        if (
            unsaved.length > 0 &&
            !(await confirm({
                title: 'Đóng tệp chưa lưu',
                description: `${unsaved.length} tệp chưa lưu được. Đóng và bỏ thay đổi?`,
                action: 'Đóng và bỏ',
            }))
        ) {
            return;
        }

        paths.forEach((path) => drafts.current.delete(path));
        const rest = tabs.filter((item) => !gone.has(item));

        setTabs(rest);

        if (selected === null || !gone.has(selected)) {
            return;
        }

        const next = rest[Math.min(tabs.indexOf(selected), rest.length - 1)];

        if (next === undefined) {
            setSelected(null);
            setDraft(null);
        } else {
            void openFile(next, true);
        }
    };

    const toggleDir = (path: string) =>
        setOpenDirs((current) => {
            const next = new Set(current);

            if (!next.delete(path)) {
                next.add(path);
            }

            return next;
        });

    return (
        <>
            {confirmDialog}
            <QuickOpen
                open={quickOpen}
                onOpenChange={setQuickOpen}
                paths={paths ?? []}
                onPick={(path) => {
                    setMarked(new Set());
                    void openFile(path);
                }}
            />
            {/* * Open file: its own column between the chat and the tree. */}
            {showChanges && (
                <section
                    aria-label="Thay đổi so với git"
                    className="@container relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex [&>*]:@max-[10rem]:hidden"
                >
                    <div className="flex h-12 items-center gap-2 border-b px-3 text-sm font-medium">
                        Thay đổi
                        {(localChanges.files ?? []).length > 0 && (
                            <span className="text-muted-foreground tabular-nums">
                                {(localChanges.files ?? []).length} tệp
                            </span>
                        )}
                        <CommitActions
                            root={localRoot}
                            disabled={
                                !localChanges.git ||
                                (localChanges.files ?? []).length === 0
                            }
                            accountId={aiSelection?.accountId ?? null}
                            model={aiSelection?.model ?? null}
                            onCommitted={localChanges.refresh}
                        />
                    </div>
                    <LocalChanges
                        root={localRoot}
                        list={localChanges}
                        onOpenFile={(path) => void openFile(path)}
                        actions={fileActions}
                    />
                </section>
            )}
            {selected !== null && !showChanges && (
                <section
                    aria-label="Nội dung tệp"
                    className="@container relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex [&>*]:@max-[10rem]:hidden"
                >
                    <div
                        role="tablist"
                        aria-label="Tệp đang mở"
                        className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
                    >
                        {tabs.map((path) => {
                            const name = path.split('/').pop() ?? path;
                            const active = path === selected;

                            return (
                                <ContextMenu key={path}>
                                    <ContextMenuTrigger asChild>
                                        <div
                                            draggable
                                            onDragStart={(event) => {
                                                event.dataTransfer.effectAllowed =
                                                    'move';
                                                setDraggedTab(path);
                                            }}
                                            onDragOver={(event) => {
                                                if (draggedTab === null) {
                                                    return;
                                                }

                                                event.preventDefault();
                                                setDropTab(path);
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();

                                                if (
                                                    draggedTab !== null &&
                                                    draggedTab !== path
                                                ) {
                                                    moveTab(draggedTab, path);
                                                }
                                            }}
                                            onDragEnd={() => {
                                                setDraggedTab(null);
                                                setDropTab(null);
                                            }}
                                            className={cn(
                                                draggedTab === path &&
                                                    'opacity-50',
                                                dropTab === path &&
                                                    draggedTab !== path &&
                                                    'ring-2 ring-ring',
                                                'group flex h-8 max-w-48 shrink-0 items-center gap-1.5 rounded-lg pr-1 pl-2 text-sm transition-colors duration-150 motion-reduce:transition-none',
                                                active
                                                    ? 'bg-muted text-foreground'
                                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                                            )}
                                        >
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={active}
                                                title={path}
                                                onClick={() =>
                                                    active
                                                        ? undefined
                                                        : void openFile(path)
                                                }
                                                className="flex min-w-0 items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                            >
                                                <FileIcon
                                                    name={name}
                                                    className="size-4 shrink-0"
                                                />
                                                <span className="truncate">
                                                    {name}
                                                </span>
                                                {isDirty(path) && (
                                                    <span
                                                        role="img"
                                                        aria-label="Chưa lưu"
                                                        className="size-1.5 shrink-0 rounded-full bg-foreground/60"
                                                    />
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Đóng ${name}`}
                                                onClick={() => closeTab(path)}
                                                className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                            >
                                                <X
                                                    aria-hidden="true"
                                                    className="size-3.5"
                                                />
                                            </button>
                                        </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent className="w-60">
                                        <ContextMenuItem
                                            onSelect={() => closeTab(path)}
                                        >
                                            Đóng
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                            disabled={tabs.length < 2}
                                            onSelect={() =>
                                                closeTabs(
                                                    tabs.filter(
                                                        (item) => item !== path,
                                                    ),
                                                )
                                            }
                                        >
                                            Đóng các tab khác
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                            disabled={
                                                tabs.indexOf(path) ===
                                                tabs.length - 1
                                            }
                                            onSelect={() =>
                                                closeTabs(
                                                    tabs.slice(
                                                        tabs.indexOf(path) + 1,
                                                    ),
                                                )
                                            }
                                        >
                                            Đóng các tab bên phải
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                            onSelect={() => closeTabs(tabs)}
                                        >
                                            Đóng tất cả
                                        </ContextMenuItem>
                                        <ContextMenuSeparator />
                                        <ContextMenuItem
                                            onSelect={() =>
                                                fileActions.copy(path)
                                            }
                                        >
                                            Sao chép đường dẫn
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                            disabled={
                                                fileActions.ask === undefined
                                            }
                                            onSelect={() =>
                                                fileActions.ask?.(path)
                                            }
                                        >
                                            Thêm tệp vào chat
                                        </ContextMenuItem>
                                    </ContextMenuContent>
                                </ContextMenu>
                            );
                        })}
                    </div>
                    <div className="flex h-12 items-center justify-between gap-2 border-b px-3 text-xs text-muted-foreground">
                        <span className="truncate" dir="rtl">
                            <bdi>
                                {selected.split('/').slice(0, -1).join(' / ')}
                                {selected.includes('/') && ' / '}
                                <span className="font-medium text-foreground">
                                    {selected.split('/').pop()}
                                </span>
                            </bdi>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                            {isMarkdown &&
                                content !== null &&
                                proposed === null && (
                                    <Tabs
                                        value={preview ? 'view' : 'code'}
                                        onValueChange={(value) =>
                                            setPreview(value === 'view')
                                        }
                                    >
                                        <TabsList className="h-7">
                                            <TabsTrigger
                                                value="view"
                                                className="gap-1 px-2.5 text-xs"
                                            >
                                                <Eye aria-hidden="true" />
                                                Xem
                                            </TabsTrigger>
                                            <TabsTrigger
                                                value="code"
                                                className="gap-1 px-2.5 text-xs"
                                            >
                                                <Code2 aria-hidden="true" />
                                                Mã
                                            </TabsTrigger>
                                        </TabsList>
                                    </Tabs>
                                )}
                            {pendingEdit !== undefined && (
                                <>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        aria-label="Áp dụng thay đổi của AI"
                                        title="Áp dụng thay đổi của AI vào tệp (Cmd/Ctrl+S)"
                                        disabled={deciding}
                                        onClick={() => void decideEdit('apply')}
                                        className="h-7 gap-1 px-2 text-xs text-green-600 dark:text-green-400"
                                    >
                                        <Check aria-hidden="true" />
                                        Áp dụng
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        aria-label="Bỏ thay đổi của AI"
                                        title="Bỏ thay đổi của AI"
                                        disabled={deciding}
                                        onClick={() =>
                                            void decideEdit('reject')
                                        }
                                        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                                    >
                                        <Undo2 aria-hidden="true" />
                                        Bỏ
                                    </Button>
                                </>
                            )}
                            {appliedEdit !== undefined && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Hoàn tác thay đổi của AI"
                                    title="Hoàn tác thay đổi của AI"
                                    disabled={deciding}
                                    onClick={() => void decideEdit('revert')}
                                    className="size-7 text-muted-foreground"
                                >
                                    <Undo2 aria-hidden="true" />
                                </Button>
                            )}
                            {onInlineAsk &&
                                content !== null &&
                                proposed === null &&
                                image === null &&
                                !(preview && isMarkdown) && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Hỏi AI về đoạn đang chọn hoặc cả tệp"
                                        title="Hỏi AI về đoạn đang chọn (không chọn: cả tệp) · ⌘L"
                                        onClick={() => askTrigger.current?.()}
                                        className="size-7"
                                    >
                                        <AssistantAvatar
                                            {...(assistant ?? {})}
                                            className="size-5"
                                        />
                                    </Button>
                                )}

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Đóng tệp"
                                onClick={() => closeTab(selected)}
                                className="size-7"
                            >
                                <X aria-hidden="true" />
                            </Button>
                        </span>
                    </div>
                    {saveError !== null && (
                        <p
                            role="alert"
                            className="border-b px-3 py-1.5 text-xs text-destructive"
                        >
                            {saveError}
                        </p>
                    )}
                    {/* * The comment boxes float in this layer: it stays put while the file reloads, so a box survives the diff opening. */}
                    <div
                        ref={boxHost}
                        className="relative flex min-h-0 flex-1 flex-col"
                    >
                        {fileError !== null ? (
                            <p
                                role="alert"
                                className="m-4 text-sm text-destructive"
                            >
                                {fileError}
                            </p>
                        ) : content === null ? (
                            <LoadingRows rows={8} className="px-4 py-4" />
                        ) : image !== null && isPdfSource(image) ? (
                            <iframe
                                src={image}
                                title={selected}
                                className="min-h-0 flex-1 border-0"
                            />
                        ) : image !== null ? (
                            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
                                <img
                                    src={image}
                                    alt={selected}
                                    className="max-h-full max-w-full object-contain rounded-md border bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                                />
                            </div>
                        ) : preview && isMarkdown && proposed === null ? (
                            <div
                                className="min-h-0 flex-1 overflow-auto p-4"
                                // * Editing happens in the code view (the rendered text cannot be written back to markdown without rewriting the file): a double click on the text opens it.
                                onDoubleClick={() =>
                                    editable && setPreview(false)
                                }
                                title={editable ? 'Bấm đúp để sửa' : undefined}
                            >
                                <MarkdownContent content={content} />
                            </div>
                        ) : (
                            <div className="relative min-h-0 flex-1">
                                <Suspense
                                    fallback={
                                        <p className="m-4 text-sm text-muted-foreground">
                                            Đang tải...
                                        </p>
                                    }
                                >
                                    {proposed !== null && (
                                        <div className="absolute inset-0 z-10 bg-background">
                                            <MonacoDiff
                                                path={selected}
                                                typingLine={revealed}
                                                original={base ?? content}
                                                modified={
                                                    revealed === null
                                                        ? proposed
                                                        : typedLines(
                                                              base ?? content,
                                                              proposed,
                                                              revealed,
                                                          )
                                                }
                                            />
                                        </div>
                                    )}
                                    {/* * The editor stays mounted under a diff so the comment boxes opened in it keep showing. */}
                                    <div
                                        className={cn(
                                            'absolute inset-0',
                                            proposed !== null && 'invisible',
                                        )}
                                    >
                                        <MonacoCode
                                            boxHost={boxHost}
                                            revealLine={revealAt}
                                            path={selected}
                                            value={typing ?? draft ?? content}
                                            onChange={
                                                editable
                                                    ? (next) =>
                                                          setDraft(
                                                              next === content
                                                                  ? null
                                                                  : next,
                                                          )
                                                    : undefined
                                            }
                                            // * Ctrl/Cmd+S: applies the AI's edit when one is waiting, else saves the typed text now.
                                            onSave={() =>
                                                void (pendingEdit !==
                                                    undefined &&
                                                revealed === null
                                                    ? decideEdit('apply')
                                                    : save())
                                            }
                                            baseline={baseline}
                                            assistant={assistant}
                                            askTrigger={askTrigger}
                                            onInlineAsk={
                                                onInlineAsk
                                                    ? (range, ...rest) =>
                                                          onInlineAsk(
                                                              {
                                                                  path: selected,
                                                                  ...range,
                                                              },
                                                              ...rest,
                                                          )
                                                    : undefined
                                            }
                                            onAsk={
                                                onAsk
                                                    ? (range) => {
                                                          // * The chat may be squeezed out by a wide file: give it its 22rem back before it takes the snippet.
                                                          fileWidth.shrinkTo(
                                                              window.innerWidth -
                                                                  352 -
                                                                  96 -
                                                                  treeWidth.width,
                                                          );
                                                          onAsk({
                                                              path: selected,
                                                              ...range,
                                                          });
                                                      }
                                                    : undefined
                                            }
                                        />
                                    </div>
                                </Suspense>
                            </div>
                        )}
                    </div>
                </section>
            )}
            {/* * File tree: the far-right column, like an editor's explorer. */}
            <aside
                aria-label={`Cây thư mục ${sourceName}`}
                style={{ width: treeWidth.width }}
                className="relative ml-auto hidden min-h-0 max-w-full shrink-0 flex-col border-l md:flex"
            >
                <ResizeHandle
                    label="Đổi độ rộng cây thư mục"
                    {...treeWidth.handleProps}
                />
                <header className="flex h-12 items-center justify-between gap-2 border-b px-3">
                    {repos.length > 1 ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Chọn dự án để xem tệp"
                                    className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <span className="truncate">
                                        {sourceName}
                                    </span>
                                    <ChevronDown
                                        aria-hidden="true"
                                        className="size-4 shrink-0 text-muted-foreground"
                                    />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                {repos.map((item) => (
                                    <DropdownMenuItem
                                        key={item}
                                        onSelect={() => onViewRepo(item)}
                                        className="justify-between gap-3"
                                    >
                                        <span className="truncate">
                                            {item.startsWith('local:')
                                                ? `Máy local · ${item.slice(6)}`
                                                : item}
                                        </span>
                                        {item === repo && (
                                            <Check aria-hidden="true" />
                                        )}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : null}
                    <span className="ml-auto flex shrink-0 items-center gap-0.5">
                        {headerActions}
                    </span>
                </header>
                {localRoot !== null && (
                    <Tabs
                        value={view}
                        onValueChange={(value) =>
                            setView(value === 'changes' ? 'changes' : 'files')
                        }
                        className="border-b px-2 py-1.5"
                    >
                        <TabsList className="h-8 w-full">
                            <TabsTrigger value="files" className="text-xs">
                                Tệp
                            </TabsTrigger>
                            <TabsTrigger value="changes" className="text-xs">
                                Thay đổi
                                {(localChanges.files ?? []).length > 0 && (
                                    <span className="ml-1 tabular-nums">
                                        {(localChanges.files ?? []).length}
                                    </span>
                                )}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
                <nav
                    aria-label="Cây thư mục"
                    className="flex min-h-0 flex-1 flex-col gap-2 p-2"
                >
                    <Input
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        aria-label="Lọc tệp"
                        placeholder="Lọc tệp..."
                        className="h-8"
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {paths === null ? (
                            <LoadingRows rows={10} className="px-2" />
                        ) : error !== null ? (
                            <p
                                role="alert"
                                className="px-2 text-sm text-destructive"
                            >
                                {error}
                            </p>
                        ) : tree.length === 0 ? (
                            <p className="px-2 text-sm text-muted-foreground">
                                Không có tệp nào.
                            </p>
                        ) : (
                            <TreeItems
                                nodes={tree}
                                depth={0}
                                openDirs={effectiveOpen}
                                onToggle={toggleDir}
                                selected={selected}
                                onSelect={(path) => {
                                    setMarked(new Set());
                                    void openFile(path);
                                }}
                                marked={marked}
                                onMark={(path) =>
                                    setMarked((current) => {
                                        const next = new Set(current);

                                        // * The open file joins the first Cmd/Ctrl+click, so a selection starts from what is on screen.
                                        if (
                                            current.size === 0 &&
                                            selected !== null
                                        ) {
                                            next.add(selected);
                                        }

                                        if (!next.delete(path)) {
                                            next.add(path);
                                        }

                                        return next;
                                    })
                                }
                                changed={changedActions}
                                changedDirs={changedDirs}
                                actions={fileActions}
                            />
                        )}
                    </div>
                </nav>
            </aside>
        </>
    );
}
