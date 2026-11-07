import { notifyDocumentSaved } from '@/lib/language-save';
import { t } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cachedRequest } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import { useConfirm } from '@/hooks/use-confirm';
import { firstChangedLine, reconstructOriginal } from '@/lib/proposal-original';
import { readSvgFile } from '@/lib/svg-file';
import type { AiChatProposal } from '@/types';
import { LIVE_REFRESH_MS } from './constants';
import { typedLines } from './typed-lines';

const errorText = requestErrorMessage;

/** * The open files of the viewer: tabs (with the preview tab), the selected file's text, the person's unsaved edit and its autosave, the live refresh from disk and closing tabs. */
export function useFileSession({
    repo,
    branch,
    localRoot,
    paths,
    changed,
    openRequest,
    isPreviewTabEnabled,
    isAutoSaveEnabled,
}: {
    repo: string;
    branch: string | null;
    localRoot: string | null;
    /** * The project's paths, null while the tree is loading. */
    paths: string[] | null;
    changed: Map<string, AiChatProposal>;
    openRequest: { repo: string; path: string; id: number } | null;
    /** * Off: a file opened by a click gets a normal tab. */
    isPreviewTabEnabled: boolean;
    /** * Off: an edit is saved only by Cmd/Ctrl+S. */
    isAutoSaveEnabled: boolean;
}) {
    const [selected, setSelected] = useState<string | null>(null);
    // * Files open as tabs (the active one is `selected`); an unsaved edit of a tab that is not active waits in `drafts`.
    const [tabs, setTabs] = useState<string[]>([]);
    // * Like VS Code: a file opened by a click is a preview tab (italic) that the next opened file replaces; typing or saving keeps it.
    const [previewTab, setPreviewTab] = useState<string | null>(null);
    const previewRef = useRef<string | null>(null);

    previewRef.current = previewTab;

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

    // * Another project: its files are not these tabs.
    const shownRepo = useRef(repo);

    useEffect(() => {
        if (shownRepo.current !== repo) {
            shownRepo.current = repo;
            drafts.current.clear();
            setTabs([]);
            setPreviewTab(null);
            setSelected(null);
        }
    }, [repo]);

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

        setTabs((current) => {
            if (current.includes(path)) {
                return current;
            }

            const replaced = previewRef.current;

            return replaced !== null && current.includes(replaced)
                ? current.map((item) => (item === replaced ? path : item))
                : [...current, path];
        });
        setPreviewTab((current) =>
            tabs.includes(path) || !isPreviewTabEnabled ? current : path,
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
            setFileError(
                errorText(caught, t('use_file_session.could_not_open_the')),
            );
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

        const typed = draft;

        try {
            // * The backend formats the text with Prettier as it is saved, like format-on-save in VS Code.
            const { data: written } = await api.post<string>(
                '/ai-chat/local/format',
                { root: localRoot, path: selected, content: typed },
            );
            await api.put('/ai-chat/local/file', {
                root: localRoot,
                path: selected,
                content: written,
                original: content,
            });
            // * A language server (if one runs for this file) hears that the file reached the disk.
            notifyDocumentSaved(localRoot, selected, written);
            setContent(written);
            // * Typing went on during the request: that newer text stays a draft and is saved next.
            setDraft((current) => (current === typed ? null : current));
            if (draftRef.current === typed) {
                drafts.current.delete(selected);
            }
        } catch (caught) {
            setSaveError(
                errorText(caught, t('use_file_session.could_not_save_the')),
            );
        } finally {
            setSaving(false);
        }
    };

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
            toast.error(
                errorText(
                    caught,
                    t('use_file_session.could_not_save_path', { path }),
                ),
            );

            return false;
        }
    };
    const draftOf = (path: string) =>
        path === selected ? (draft ?? undefined) : drafts.current.get(path);

    // * No save button: an edit is written to the file shortly after typing stops.
    const autoSave = useRef(save);

    autoSave.current = save;

    useEffect(() => {
        if (!isAutoSaveEnabled || draft === null || saving) {
            return;
        }

        const timer = window.setTimeout(() => void autoSave.current(), 800);

        return () => window.clearTimeout(timer);
    }, [draft, saving, isAutoSaveEnabled]);

    // * Only a plain local text file can be edited; GitHub files and AI proposals stay read-only.
    const editable =
        localRoot !== null &&
        proposed === null &&
        image === null &&
        typing === null;

    // * The first edit keeps the preview tab.
    useEffect(() => {
        if (draft !== null && selected !== null && selected === previewTab) {
            setPreviewTab(null);
        }
    }, [draft, selected, previewTab]);

    const isDirty = (path: string) =>
        path === selected ? draft !== null : drafts.current.has(path);

    const { confirm, dialog: confirmDialog } = useConfirm();

    const closeTab = async (path: string) => {
        // * Closing the tab saves what was typed; only a failed write asks whether to drop it.
        if (
            isDirty(path) &&
            !(await persist(path, draftOf(path))) &&
            !(await confirm({
                title: t('use_file_session.close_unsaved_file'),
                description: t('use_file_session.name_could_not_be', {
                    name: path.split('/').pop() ?? path,
                }),
                action: t('use_file_session.close_and_discard'),
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

    // * Several tabs at once (the tab menu): one confirmation if any has unsaved edits; the open file moves to the nearest tab left.
    const closeTabs = async (closing: string[]) => {
        const gone = new Set(closing);
        // * Each unsaved tab is written first; only the ones that fail ask whether to drop them.
        const results = await Promise.all(
            closing
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
                title: t('use_file_session.close_unsaved_file'),
                description: t('use_file_session.count_files_could_not', {
                    count: unsaved.length,
                }),
                action: t('use_file_session.close_and_discard'),
            }))
        ) {
            return;
        }

        closing.forEach((path) => drafts.current.delete(path));
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

    return {
        selected,
        tabs,
        previewTab,
        setPreviewTab,
        view,
        setView,
        content,
        draft,
        setDraft,
        typing,
        revealAt,
        baseline,
        saveError,
        proposed,
        base,
        fileError,
        image,
        editable,
        openFile,
        save,
        moveTab,
        isDirty,
        closeTab,
        closeTabs,
        confirmDialog,
    };
}
