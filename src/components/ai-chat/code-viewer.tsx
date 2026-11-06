import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { QuickOpen } from '@/components/ai-chat/quick-open';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { AiChatProposal } from '@/types';
import { ChangesPanel } from './code-viewer/changes-panel';
import { EditorBody } from './code-viewer/editor-body';
import { EditorToolbar } from './code-viewer/editor-toolbar';
import { FileTabs } from './code-viewer/file-tabs';
import { TreePanel } from './code-viewer/tree-panel';
import type { AskReference, InlineAskHandler } from './code-viewer/types';
import { useAiEdit } from './code-viewer/use-ai-edit';
import { useFileSession } from './code-viewer/use-file-session';
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
    onAsk,
    onInlineAsk,
    assistant,
    onChangesUpdate,
    aiSelection,
    onActiveFile,
    onEditorVisible,
    chatCollapsed = false,
    tabsEnd,
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
    /** * The person picked lines and chose "Chat với AI": the chat takes them as a reference. */
    onAsk?: (reference: AskReference) => void;
    /** * "Chat với AI về đoạn này" answers in a comment box under the lines: asks about them and returns the answer (the same conversation continues with `conversation`). */
    onInlineAsk?: InlineAskHandler;
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
    /** Buttons pinned to the right end of the tab bar. */
    tabsEnd?: ReactNode;
    /** Double click on a file of the tree: the chat attaches it (path inside the project). */
    onAttachFile?: (path: string) => void;
    /** * Files picked together with Cmd/Ctrl+click (empty: none): the chat tags all of them. */
    onMarkedFiles?: (paths: string[]) => void;
}) {
    const { copy: copyPath } = useCopyToClipboard();
    const { fileWidth, treeWidth } = usePanelWidths(chatCollapsed);
    const localRoot = repo.startsWith('local:') ? repo.slice(6) : null;
    // * The local repo is addressed by its full path; only the folder name is shown.
    const sourceName = localRoot
        ? `Máy local · ${localRoot.split('/').pop() || localRoot}`
        : repo;
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
    });

    useEffect(() => {
        onActiveFile?.(selected);
    }, [selected, onActiveFile]);

    const [marked, setMarked] = useState<Set<string>>(new Set());

    useEffect(() => {
        onMarkedFiles?.([...marked]);
    }, [marked, onMarkedFiles]);

    // * A markdown file can be read rendered instead of as code (resets when another file opens).
    const [preview, setPreview] = useState(true);
    const isMarkdown = /\.(md|markdown)$/i.test(selected ?? '');

    useEffect(() => setPreview(true), [selected]);

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

    const showChanges = localRoot !== null && view === 'changes';
    const editorVisible = selected !== null || showChanges;

    useEffect(() => {
        onEditorVisible?.(editorVisible);
    }, [editorVisible, onEditorVisible]);

    // * Cmd/Ctrl+P: find a file by name (while this viewer is on screen).
    const [quickOpen, setQuickOpen] = useState(false);
    const openQuickOpen = useCallback(() => setQuickOpen(true), []);

    useQuickOpenShortcut(openQuickOpen);

    // * Set by the editor: asks about its selection (the whole file when nothing is selected).
    const askTrigger = useRef<(() => void) | null>(null);
    // * The right-click menu of every file row (tree and change list) and of the open-file tabs shares these.
    const fileActions: FileActions = useMemo(
        () => ({
            copy: (path) => {
                void copyPath(path);
            },
            ask: onAsk
                ? (path) =>
                      onAsk({ path, startLine: 0, endLine: 0, text: path })
                : undefined,
        }),
        [copyPath, onAsk],
    );

    // * Stable handlers: the tab bar and the tree rows are memoized, so typing in the editor does not re-render them.
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

    return (
        <>
            {confirmDialog}
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
                />
            )}
            {selected !== null && !showChanges && (
                <section
                    aria-label="Nội dung tệp"
                    className="@container relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex [&>*]:@max-[10rem]:hidden"
                >
                    <FileTabs
                        tabs={tabs}
                        selected={selected}
                        previewTab={previewTab}
                        dirtyPaths={dirtyPaths}
                        actions={fileActions}
                        tabsEnd={tabsEnd}
                        onOpen={openPath}
                        onClose={closeOnePath}
                        onCloseMany={closeManyPaths}
                        onMove={moveOnePath}
                        onKeepPreview={keepPreviewTab}
                    />
                    <EditorToolbar
                        selected={selected}
                        preview={preview}
                        onPreviewChange={setPreview}
                        showPreviewSwitch={
                            isMarkdown && content !== null && proposed === null
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
                        onClose={closeOnePath}
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
                            revealAt={revealAt}
                            revealed={revealed}
                            baseline={baseline}
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
            {/* * File tree: the far-right column, like an editor's explorer. */}
            <TreePanel
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
        </>
    );
}
