import { t } from '@/lib/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FolderOpen } from 'lucide-react';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { cn } from '@/lib/utils';
import { QuickOpen } from '@/components/ai-chat/quick-open';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import { api } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { usePanelPlacement } from '@/hooks/use-panel-placement';
import type { AiChatProposal } from '@/types';
import { ChangesPanel } from './code-viewer/changes-panel';
import { EditorBody } from './code-viewer/editor-body';
import { RenameDialog } from './code-viewer/rename-dialog';
import { EditorToolbar } from './code-viewer/editor-toolbar';
import { FileTabs } from './code-viewer/file-tabs';
import { TreePanel } from './code-viewer/tree-panel';
import type { AskReference, InlineAskHandler } from './code-viewer/types';
import { useAiEdit } from './code-viewer/use-ai-edit';
import { useFileSession } from './code-viewer/use-file-session';
import { useBlame } from './code-viewer/use-blame';
import { useCursorStore } from './code-viewer/cursor-position';
import { useEditorOptions } from './code-viewer/use-editor-options';
import { EditorOptionsMenu } from './code-viewer/editor-options-menu';
import { useFileTree } from './code-viewer/use-file-tree';
import {
    useQuickOpenShortcut,
    useSaveShortcut,
} from './code-viewer/use-keyboard-shortcuts';
import { usePanelWidths } from './code-viewer/use-panel-widths';
import { useStableCallback } from './code-viewer/use-stable-callback';

/** * Code viewer of the selected project: file tree on the right, the open file (editable for local projects) on the left. */
export function CodeViewer({
    repo,
    repos,
    onViewRepo,
    headerActions,
    branch = null,
    changes,
    openRequest = null,
    changesRequest = 0,
    onAsk,
    onInlineAsk,
    onShowHistory,
    assistant,
    onChangesUpdate,
    aiSelection,
    onActiveFile,
    onEditorVisible,
    chatCollapsed = false,
    tabsStart,
    tabsEnd,
    treePlacement,
    treeClosed,
    onTreeClosedChange,
    alwaysShowEditor = false,
    onAttachFile,
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
    /** * Counter the host bumps to switch to the Changes view (local projects only). */
    changesRequest?: number;
    /** * The person picked lines and chose "Chat với AI": the chat takes them as a reference. */
    onAsk?: (reference: AskReference) => void;
    /** * "Chat với AI về đoạn này" answers in a comment box under the lines: asks about them and returns the answer (the same conversation continues with `conversation`). */
    onInlineAsk?: InlineAskHandler;
    /** * "Lịch sử tệp": shows the git history of this file (missing: the menu entry is hidden). */
    onShowHistory?: (path: string) => void;
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
    /** The chat is closed; when it opens again the columns make room for it. */
    chatCollapsed?: boolean;
    /** Buttons pinned to the left end of the tab bar. */
    tabsStart?: ReactNode;
    /** Buttons pinned to the right end of the tab bar. */
    tabsEnd?: ReactNode;
    /** Left or right of the editor; the owner also moves the whole file area in front of the chat when it is left. */
    treePlacement: ReturnType<typeof usePanelPlacement>;
    /** The host holds whether the file tree is closed (and draws the button that opens it). */
    treeClosed?: boolean;
    onTreeClosedChange?: (closed: boolean) => void;
    /** The editor column is always there: with no file open it shows an empty state instead of hiding. */
    alwaysShowEditor?: boolean;
    /** Double click on a file of the tree: the chat attaches it (path inside the project). */
    onAttachFile?: (path: string) => void;
    /** * Files picked together with Cmd/Ctrl+click (empty: none): the chat tags all of them. */
    onMarkedFiles?: (paths: string[]) => void;
}) {
    const isFullscreen = useFullscreen();
    const { copy: copyPath } = useCopyToClipboard();
    const { fileWidth, changesWidth, treeWidth } = usePanelWidths(
        chatCollapsed,
        treePlacement.placement === 'left' ? 'trailing' : 'leading',
    );
    const localRoot = repo.startsWith('local:') ? repo.slice(6) : null;
    // * The local repo is addressed by its full path; only the folder name is shown.
    const sourceName = localRoot
        ? t('common.local_machine_name', {
              name: localRoot.split('/').pop() || localRoot,
          })
        : repo;
    const cursorStore = useCursorStore();
    const { options: editorOptions, setOption: setEditorOption } =
        useEditorOptions();
    const {
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
        revealPath,
        reload,
        collapseAll,
    } = useFileTree({ repo, branch, localRoot, changes });
    const {
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
    } = useFileSession({
        repo,
        branch,
        localRoot,
        paths,
        changed,
        openRequest,
        isPreviewTabEnabled: editorOptions.previewTabs,
        isAutoSaveEnabled: editorOptions.autoSave,
    });

    // * Blame lines belong to the saved text: unsaved edits (typed or by the AI) hide the note.
    const isBlameVisible = draft === null && typing === null;

    useEffect(() => {
        onActiveFile?.(selected);
    }, [selected, onActiveFile]);

    const [marked, setMarked] = useState<Set<string>>(new Set());

    // * The open file is shown in the tree: its folders open and its row scrolls into view.
    useEffect(() => {
        if (selected === null) {
            return;
        }

        revealPath(selected);

        const frame = requestAnimationFrame(() =>
            document
                .querySelector(
                    `[role="treeitem"][data-path="${CSS.escape(selected)}"]`,
                )
                ?.scrollIntoView({ block: 'nearest' }),
        );

        return () => cancelAnimationFrame(frame);
    }, [selected, revealPath]);

    useEffect(() => {
        onMarkedFiles?.([...marked]);
    }, [marked, onMarkedFiles]);

    // * A markdown file can be read rendered instead of as code (resets when another file opens).
    const [preview, setPreview] = useState(true);
    const isMarkdown = /\.(md|markdown)$/i.test(selected ?? '');

    useEffect(() => setPreview(true), [selected]);

    const blame = useBlame({
        root: localRoot,
        path: selected,
        content,
        isActive:
            proposed === null && image === null && !(preview && isMarkdown),
    });

    const {
        pendingEdit,
        appliedEdit,
        boxHost,
        revealed,
        deciding,
        decideEdit,
    } = useAiEdit({
        repo,
        localRoot,
        selected,
        proposed,
        base,
        content,
        changes,
        openFile,
        onChangesUpdate,
    });

    // * Cmd/Ctrl+S: applies the AI's edit when one is waiting, else saves now.
    useSaveShortcut(
        selected,
        () => void (pendingEdit !== undefined ? decideEdit('apply') : save()),
    );

    // * A bump of the counter (not its first value) opens the Changes view.
    const [seenChangesRequest, setSeenChangesRequest] =
        useState(changesRequest);

    if (changesRequest !== seenChangesRequest) {
        setSeenChangesRequest(changesRequest);

        if (localRoot !== null) {
            setView('changes');
        }
    }

    // * The options menu asks the tree to name a new file or folder at the root (a new object per request).
    const [createRequest, setCreateRequest] = useState<{
        isFolder: boolean;
    } | null>(null);
    const requestCreate = (isFolder: boolean) => {
        setView('files');
        setCreateRequest({ isFolder });
    };

    const showChanges = localRoot !== null && view === 'changes';
    const editorVisible = selected !== null || showChanges;
    // * The chat is folded away: the open file or change list takes its room, so no empty gap is left.
    const isFilling = chatCollapsed && editorVisible;
    // * No file open: the editor column stays as a small empty state; the chat keeps the rest of the width.
    const showEmpty = alwaysShowEditor && !editorVisible && treeClosed !== true;

    useEffect(() => {
        onEditorVisible?.(editorVisible);
    }, [editorVisible, onEditorVisible]);

    // * Cmd/Ctrl+P: find a file by name (while this viewer is on screen).
    const [quickOpen, setQuickOpen] = useState(false);
    const openQuickOpen = useCallback(() => setQuickOpen(true), []);

    useQuickOpenShortcut(openQuickOpen);

    // * Shift+Cmd/Ctrl+Y: shows or hides the file tree (when the host holds its closed state).
    useEffect(() => {
        if (onTreeClosedChange === undefined) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.shiftKey &&
                event.key.toLowerCase() === 'y'
            ) {
                event.preventDefault();
                onTreeClosedChange(treeClosed !== true);
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [treeClosed, onTreeClosedChange]);

    // * Set by the editor: asks about its selection (the whole file when nothing is selected).
    const askTrigger = useRef<(() => void) | null>(null);
    // * The right-click menu of every file row (tree and change list) and of the open-file tabs shares these.
    // * The file whose new name is being asked (null: none).
    const [renaming, setRenaming] = useState<string | null>(null);
    const fileActions: FileActions = useMemo(
        () => ({
            copy: (path) => {
                void copyPath(path);
            },
            copyName: (path) => {
                void copyPath(path.split('/').pop() ?? path);
            },
            rename: localRoot === null ? undefined : setRenaming,
            history: localRoot === null ? undefined : onShowHistory,
            ask: onAsk
                ? (path) =>
                      onAsk({ path, startLine: 0, endLine: 0, text: path })
                : undefined,
        }),
        [copyPath, onAsk, localRoot, onShowHistory],
    );

    // * Stable handlers: the tab bar and the tree rows are memoized, so typing in the editor does not re-render them.
    // * The tab is closed first (that saves what was typed), the file renamed, the tree read again and the file opened under its new name.
    const renameFile = useStableCallback(
        async (path: string, newName: string) => {
            const wasOpen = tabs.includes(path);

            await closeTab(path);

            const { data } = await api.post<string>('/ai-chat/local/rename', {
                root: localRoot,
                path,
                newName,
            });

            reload();

            if (wasOpen) {
                void openFile(data);
            }
        },
    );
    // * A definition in another file: the file opens and the editor scrolls to its line.
    const [jump, setJump] = useState<{
        path: string;
        line: number;
        id: number;
    } | null>(null);
    const openDefinition = useStableCallback((path: string, line: number) => {
        setJump({ path, line, id: Date.now() });
        void openFile(path);
    });
    const openPath = useStableCallback((path: string) => void openFile(path));
    const selectInTree = useStableCallback((path: string) => {
        setMarked(new Set());
        void openFile(path);
    });
    const markInTree = useStableCallback((path: string) =>
        setMarked((current) => {
            const next = new Set(current);

            // * The open file joins the first Cmd/Ctrl+click, so a selection starts from what is on screen.
            if (current.size === 0 && selected !== null) {
                next.add(selected);
            }

            if (!next.delete(path)) {
                next.add(path);
            }

            return next;
        }),
    );
    const closeOnePath = useStableCallback(closeTab);
    const closeManyPaths = useStableCallback(closeTabs);
    const moveOnePath = useStableCallback(moveTab);
    const keepPreviewTab = useCallback(
        () => setPreviewTab(null),
        [setPreviewTab],
    );
    // * A string key keeps the set of unsaved tabs the same object until it really changes.
    const dirtyKey = tabs.filter(isDirty).join('\n');
    const dirtyPaths = useMemo(
        () => new Set(dirtyKey === '' ? [] : dirtyKey.split('\n')),
        [dirtyKey],
    );

    // * The chat may be squeezed out by a wide file: give it its 22rem back before it takes the snippet.
    const askFromEditor = onAsk
        ? (reference: AskReference) => {
              fileWidth.shrinkTo(
                  window.innerWidth - 352 - 96 - treeWidth.width,
              );
              onAsk(reference);
          }
        : undefined;

    // * File tree: the explorer column, on the right of the editor unless moved to the left.
    const treePanel = (
        <TreePanel
            onQuickOpen={openQuickOpen}
            placement={treePlacement}
            closed={treeClosed}
            onClosedChange={onTreeClosedChange}
            createRequest={createRequest}
            sourceName={sourceName}
            treeWidth={treeWidth}
            repo={repo}
            repos={repos}
            onViewRepo={onViewRepo}
            headerActions={headerActions}
            isLocal={localRoot !== null}
            view={view}
            onViewChange={setView}
            changedFileCount={(localChanges.files ?? []).length}
            filter={filter}
            onFilterChange={setFilter}
            onCollapseAll={collapseAll}
            onReload={reload}
            paths={paths}
            error={error}
            tree={tree}
            openDirs={effectiveOpen}
            onToggle={toggleDir}
            selected={selected}
            onSelect={selectInTree}
            marked={marked}
            onMark={markInTree}
            onAttach={onAttachFile}
            changed={changedActions}
            changedDirs={changedDirs}
            actions={fileActions}
        />
    );

    return (
        <>
            {confirmDialog}
            {treePlacement.placement === 'left' && treePanel}
            <RenameDialog
                path={renaming}
                onClose={() => setRenaming(null)}
                onRename={renameFile}
            />
            <QuickOpen
                open={quickOpen}
                onOpenChange={setQuickOpen}
                paths={paths ?? []}
                onPick={selectInTree}
            />
            {/* * Open file: its own column between the chat and the tree. */}
            {showChanges && (
                <ChangesPanel
                    localRoot={localRoot}
                    localChanges={localChanges}
                    aiSelection={aiSelection}
                    actions={fileActions}
                    onOpenFile={openPath}
                    width={changesWidth}
                    isFilling={isFilling}
                    startInset={
                        tabsStart !== undefined &&
                        (treePlacement.placement !== 'left' ||
                            treeClosed === true) &&
                        !isFullscreen
                    }
                    edge={
                        treePlacement.placement === 'left'
                            ? 'trailing'
                            : 'leading'
                    }
                />
            )}
            {selected !== null && !showChanges && (
                <section
                    aria-label={t('code_viewer.file_content')}
                    style={isFilling ? undefined : { width: fileWidth.width }}
                    className={cn(
                        '@container relative hidden min-h-0 max-w-full min-w-0 flex-col overflow-hidden lg:flex [&>*]:@max-[10rem]:hidden',
                        isFilling ? 'flex-1' : 'shrink-0',
                        treePlacement.placement !== 'left' && 'border-l',
                    )}
                >
                    {!isFilling && (
                        <ResizeHandle
                            label={t('code_viewer.resize_file_panel')}
                            className={
                                treePlacement.placement === 'left'
                                    ? 'right-0 left-auto translate-x-0'
                                    : 'translate-x-0'
                            }
                            {...fileWidth.handleProps}
                        />
                    )}
                    <FileTabs
                        tabs={tabs}
                        selected={selected}
                        previewTab={previewTab}
                        dirtyPaths={dirtyPaths}
                        actions={fileActions}
                        tabsStart={tabsStart}
                        tabsEnd={tabsEnd}
                        tools={
                            <EditorToolbar
                                preview={preview}
                                onPreviewChange={setPreview}
                                showPreviewSwitch={
                                    isMarkdown &&
                                    content !== null &&
                                    proposed === null
                                }
                                pendingEdit={pendingEdit}
                                appliedEdit={appliedEdit}
                                deciding={deciding}
                                onDecide={(kind) => void decideEdit(kind)}
                                showAsk={
                                    Boolean(onInlineAsk) &&
                                    content !== null &&
                                    proposed === null &&
                                    image === null &&
                                    !(preview && isMarkdown)
                                }
                                assistant={assistant}
                                onAskTrigger={() => askTrigger.current?.()}
                                showBlame={
                                    localRoot !== null &&
                                    content !== null &&
                                    proposed === null &&
                                    image === null &&
                                    !(preview && isMarkdown)
                                }
                                blameEnabled={blame.enabled}
                                cursorStore={cursorStore}
                                showCursor={
                                    content !== null &&
                                    proposed === null &&
                                    image === null &&
                                    !(preview && isMarkdown)
                                }
                                onBlameChange={blame.setEnabled}
                                optionsMenu={
                                    <EditorOptionsMenu
                                        options={editorOptions}
                                        onOptionChange={setEditorOption}
                                        onQuickOpen={openQuickOpen}
                                        onCreate={
                                            localRoot !== null
                                                ? requestCreate
                                                : undefined
                                        }
                                        treeClosed={treeClosed}
                                        onTreeClosedChange={onTreeClosedChange}
                                        treePlacement={treePlacement}
                                        canCollapseAll={effectiveOpen.size > 0}
                                        onCollapseAll={collapseAll}
                                    />
                                }
                            />
                        }
                        onOpen={openPath}
                        onClose={closeOnePath}
                        onCloseMany={closeManyPaths}
                        onMove={moveOnePath}
                        onKeepPreview={keepPreviewTab}
                    />

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
                        <EditorBody
                            selected={selected}
                            fileError={fileError}
                            content={content}
                            image={image}
                            preview={preview}
                            isMarkdown={isMarkdown}
                            proposed={proposed}
                            base={base}
                            editable={editable}
                            typing={typing}
                            draft={draft}
                            revealAt={
                                jump !== null && jump.path === selected
                                    ? { line: jump.line, count: 1, id: jump.id }
                                    : revealAt
                            }
                            languageServer={{
                                root: localRoot,
                                onOpenDefinition: openDefinition,
                            }}
                            revealed={revealed}
                            baseline={baseline}
                            blame={isBlameVisible ? blame.lines : null}
                            editorOptions={editorOptions}
                            cursorStore={cursorStore}
                            boxHost={boxHost}
                            assistant={assistant}
                            askTrigger={askTrigger}
                            onPreviewChange={setPreview}
                            onDraftChange={setDraft}
                            // * Ctrl/Cmd+S: applies the AI's edit when one is waiting, else saves the typed text now.
                            onSave={() =>
                                void (pendingEdit !== undefined &&
                                revealed === null
                                    ? decideEdit('apply')
                                    : save())
                            }
                            onInlineAsk={onInlineAsk}
                            onAsk={askFromEditor}
                        />
                    </div>
                </section>
            )}
            {showEmpty && (
                <section
                    aria-label={t('code_viewer.file_content')}
                    className={cn(
                        'relative hidden min-h-0 w-96 max-w-full shrink-0 flex-col overflow-hidden lg:flex',
                        treePlacement.placement !== 'left' && 'border-l',
                    )}
                >
                    {(tabsStart !== undefined || tabsEnd !== undefined) && (
                        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2">
                            <div className="flex items-center">{tabsStart}</div>
                            <div className="flex items-center gap-1">
                                {tabsEnd}
                            </div>
                        </div>
                    )}
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                        <FolderOpen
                            aria-hidden="true"
                            className="size-10 text-muted-foreground/60"
                        />
                        <p className="text-sm font-medium">
                            {t('code_viewer.empty_title')}
                        </p>
                        <p className="max-w-xs text-xs text-muted-foreground">
                            {t('code_viewer.empty_hint')}
                        </p>
                    </div>
                </section>
            )}
            {treePlacement.placement !== 'left' && treePanel}
        </>
    );
}
