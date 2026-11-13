import {
    LayoutGrid,
    ListChecks,
    MessageSquare,
    MessagesSquare,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CodeViewer } from '@/components/code-viewer';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { ChatHeaderActions } from '@/components/shell/chat-header-actions';
import { ChatPanel } from '@/components/shell/chat-panel';
import { useSideChat } from '@/components/shell/chat/use-side-chat';
import { DockLayout } from '@/components/shell/dock-layout';
import type { DockPanel } from '@/components/shell/dock-layout';
import { PanelMenu } from '@/components/shell/panel-menu';
import { PanelsMenu } from '@/components/shell/panels-menu';
import { RailPopup } from '@/components/shell/rail-popup';
import { SessionRail } from '@/components/shell/session-rail';
import { SideChatDock } from '@/components/shell/side-chat-dock';
import type { ContextUsage } from '@/components/shell/context-panel';
import { Button } from '@/components/ui/button';
import type { Pane, PaneState } from '@/hooks/use-pane-state';
import { ChangesViewerContext } from '@/contexts/changes-viewer-context';
import { usePanelPlacement } from '@/hooks/use-panel-placement';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

// * The viewer's "Hỏi AI về đoạn này" box: the Claude CLI answers about the picked lines, run in the project's folder.
const askAssistant =
    (root: string) =>
    async (
        reference: {
            path: string;
            startLine: number;
            endLine: number;
            text: string;
        },
        question: string,
    ) =>
        (
            await api.post<InlineAnswer>('/ai-chat/inline-ask', {
                root,
                ...reference,
                question,
            })
        ).data;

const noViewerChange = () => undefined;

// * Projects whose chat was already shown again in this run.
const REOPENED_CHATS = new Set<string>();

/** The chat and the code viewer of one project. */
export function WorkspacePane({
    pane,
    state,
    active,
    projects,
    terminalOpen,
    backgroundOpen,
    plansOpen,
    sidebarCollapsed,
    sidebarToggle,
    hasWindowButtons,
    bottomPanel,
    codeDetached,
    onFocusCodeWindow,
    onToggleTerminal,
    onToggleBackground,
    onTogglePlans,
    onOpenSettings,
    onOpenInVscode,
    onPatch,
    onShowHistory,
    onRefreshConversations,
}: {
    pane: Pane;
    state: PaneState;
    /** The pane of the open project: the only one that accepts the phone's messages. */
    active: boolean;
    projects: { root: string; name: string }[];
    terminalOpen: boolean;
    backgroundOpen: boolean;
    plansOpen: boolean;
    /** The phone-pairing dialog is open (the rail's Remote Control switch follows it). */
    phoneOpen: boolean;
    sidebarCollapsed: boolean;
    sidebarToggle: ReactNode;
    /** The native window buttons sit at the top-left (every case but fullscreen). */
    hasWindowButtons: boolean;
    /** The bottom panel when it sits under the work area: drawn under the file area only, never under the main chat. */
    bottomPanel: ReactNode;
    /** The code side of this project is in a window of its own: the file buttons bring that window forward instead of showing files here. */
    codeDetached: boolean;
    onFocusCodeWindow: () => void;
    /** The account menu button for the file tree header. */
    onToggleTerminal: () => void;
    onToggleBackground: () => void;
    onTogglePlans: () => void;
    onOpenSettings: () => void;
    onOpenPhone: () => void;
    onOpenInVscode: () => void;
    onPatch: (key: string, change: Partial<PaneState>) => void;
    /** Opens the history of this file of the project in the bottom panel. */
    onShowHistory: (path?: string) => void;
    onRefreshConversations: (root: string) => void;
}) {
    // * Kept here, not in the pane state: it follows the pane (which stays mounted) and nothing else needs it.
    const [sideChatOpen, setSideChatOpen] = useState(false);
    const sideChat = useSideChat(pane.root);
    const sideChatPlacement = usePanelPlacement('side-chat', 'bottom');
    // * The session rail: open or not, the context usage the chat reports, a counter bumped when a turn was saved (the rail reads files, branch and pull request again) and the file the rail asked the viewer to open.
    const [railOpen, setRailOpen] = useState(false);
    // * Left of the editor moves the whole file area (tree and editor, with the side chat under them) in front of the main chat.
    const treePlacement = usePanelPlacement('file-tree', 'right');
    const [railContext, setRailContext] = useState<ContextUsage | null>(null);
    const [railRefresh, setRailRefresh] = useState(0);
    const [openRequest, setOpenRequest] = useState<{
        repo: string;
        path: string;
        id: number;
    } | null>(null);
    // * Bumped by the card of changed files in the chat: the viewer then switches to its Changes view.
    const [changesRequest, setChangesRequest] = useState(0);
    // * A plan picked in the Plans tab opens in the viewer, like a file the rail asked for.
    const [seenOpenFile, setSeenOpenFile] = useState(state.openFile);

    if (state.openFile !== seenOpenFile) {
        setSeenOpenFile(state.openFile);

        if (state.openFile !== null) {
            const { path } = state.openFile;

            setOpenRequest((current) => ({
                repo: `local:${pane.root}`,
                path,
                id: (current?.id ?? 0) + 1,
            }));
        }
    }

    // * The whole file area (tree and editor) is folded away: it stays mounted, so its tabs and unsaved edits come back as they were.
    // * The code side in a window of its own counts as hidden here, whatever the stored flag says.
    const filesHidden = state.filesHidden || codeDetached;
    // * The tree is closed from its own header: no strip is left for it, the file button (or Cmd/Ctrl+Shift+Y) opens it again.
    const [treeClosed, setTreeClosed] = useState(false);
    const filesLabel = t(
        filesHidden ? 'workspace_pane.show_files' : 'workspace_pane.hide_files',
    );
    const toggleFiles = () => {
        if (codeDetached) {
            onFocusCodeWindow();

            return;
        }

        if (treeClosed && !filesHidden) {
            setTreeClosed(false);

            return;
        }

        onPatch(pane.key, {
            filesHidden: !filesHidden,
            // * With the files hidden the chat must stay on screen.
            ...(filesHidden ? {} : { chatCollapsed: false }),
        });
    };
    // * Sidebar folded, tree on the left but closed, a file open: the file column is the leftmost one, so the window buttons sit over its tabs and the sidebar toggle goes there instead of in the chat header.
    const filesLeadWindow =
        sidebarCollapsed &&
        treePlacement.placement === 'left' &&
        !filesHidden &&
        treeClosed &&
        state.editorVisible;
    const changesViewer = {
        open: () => {
            if (codeDetached) {
                onFocusCodeWindow();

                return;
            }

            setChangesRequest((count) => count + 1);

            if (filesHidden) {
                onPatch(pane.key, { filesHidden: false });
            }
        },
    };
    // * The open tree on the left is the leftmost column, so the window buttons sit over it; in any other layout the column holding the toggle is leftmost and the toggle starts after the buttons.
    const treeLeadsWindow =
        treePlacement.placement === 'left' && !filesHidden && !treeClosed;
    const windowedSidebarToggle = (
        <span
            className={cn(
                'flex',
                hasWindowButtons && !treeLeadsWindow && 'pl-16',
            )}
        >
            {sidebarToggle}
        </span>
    );
    // * Folded sidebar and the open tree is the leftmost column: the toggle heads the tree's toolbar (after the window buttons), not the chat header.
    const toggleInTree = sidebarCollapsed && treeLeadsWindow;
    const treeSidebarToggle = (
        <span className={cn('flex', hasWindowButtons && 'pl-16')}>
            {sidebarToggle}
        </span>
    );
    const toggleRail = () => setRailOpen((open) => !open);
    // * Alone: no file shown and the main chat folded away, so the side chat takes the whole area; any panel coming back puts it in its column again.
    const sideChatAlone =
        sideChatOpen && !state.editorVisible && state.chatCollapsed;
    const toggleSideChat = () => setSideChatOpen((open) => !open);
    // * The chat is shown again when the app starts: a chat folded away in an earlier run (squeezed out by a wide file) must not stay gone. Once per project and run, so a chat folded on purpose stays folded afterwards.
    useEffect(() => {
        if (REOPENED_CHATS.has(pane.key)) {
            return;
        }

        REOPENED_CHATS.add(pane.key);

        if (state.chatCollapsed) {
            onPatch(pane.key, { chatCollapsed: false });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the first mount of a project
    }, []);

    // * Cmd/Ctrl+; opens and closes the side chat of the open project.
    useEffect(() => {
        if (!active) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                !event.shiftKey &&
                !event.altKey &&
                event.key === ';'
            ) {
                event.preventDefault();
                setSideChatOpen((open) => !open);
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [active]);

    const placementMenu = (
        placement: ReturnType<typeof usePanelPlacement>,
        floatable = false,
    ) => (
        <PanelMenu
            placement={placement.placement}
            dockedPlacement={placement.dockedPlacement}
            floatable={floatable}
            onPlacementChange={placement.setPlacement}
        />
    );

    // * One menu for the three dock panels; every row ticks with the real state and shares the toolbar toggles.
    const panelsMenu = (
        <PanelsMenu
            items={[
                {
                    id: 'side-chat',
                    icon: MessagesSquare,
                    label: t('side_chat.title'),
                    shortcut: '\u2318;',
                    open: sideChatOpen,
                    onToggle: toggleSideChat,
                },
                {
                    id: 'background',
                    icon: ListChecks,
                    label: t('background_tasks.title'),
                    open: backgroundOpen,
                    onToggle: onToggleBackground,
                },
                {
                    id: 'plans',
                    icon: LayoutGrid,
                    label: t('plans.title'),
                    open: plansOpen,
                    onToggle: onTogglePlans,
                },
            ]}
        />
    );

    // * The session rail is a popup over the main chat, above the row under the message box.
    const railPopup =
        active && railOpen ? (
            <RailPopup onClose={() => setRailOpen(false)}>
                <SessionRail
                    root={pane.root}
                    projectName={pane.name}
                    conversation={state.conversation}
                    context={railContext}
                    refreshKey={railRefresh}
                    placementMenu={null}
                    onOpenSettings={onOpenSettings}
                    onOpenFile={(path) =>
                        setOpenRequest((current) => ({
                            repo: `local:${pane.root}`,
                            path,
                            id: (current?.id ?? 0) + 1,
                        }))
                    }
                    onShowHistory={() => onShowHistory()}
                    onClearContext={() => {
                        // * A new chat starts without the history, so the old context is no longer sent; the old chat stays in the list.
                        onPatch(pane.key, {
                            newChat: state.newChat + 1,
                            chatCollapsed: false,
                        });
                        setRailOpen(false);
                    }}
                    onClose={() => setRailOpen(false)}
                />
            </RailPopup>
        ) : null;

    const dockPanels: DockPanel[] = [
        {
            id: 'bottom-panel',
            placement: 'bottom',
            open: bottomPanel !== null,
            underTrailing: true,
            size: 256,
            content: bottomPanel,
        },
        {
            id: 'side-chat',
            // * Alone: the side chat takes the whole area, whatever edge it was set to.
            placement: sideChatAlone ? 'fill' : sideChatPlacement.placement,
            open: sideChatOpen,
            // * Default: under the file area (editor and tree), about 40% of the window height, never under the main chat.
            underTrailing: true,
            size: Math.round(window.innerHeight * 0.4),
            content: (
                <SideChatDock
                    chat={sideChat}
                    projectName={pane.name}
                    open={sideChatOpen}
                    placementMenu={placementMenu(sideChatPlacement, true)}
                    floating={sideChatPlacement.placement === 'float'}
                    onFloat={() => sideChatPlacement.setPlacement('float')}
                    onDock={() =>
                        sideChatPlacement.setPlacement(
                            sideChatPlacement.dockedPlacement,
                        )
                    }
                    alone={sideChatAlone}
                    onClose={() => setSideChatOpen(false)}
                    onOpenChat={
                        sideChatAlone
                            ? () => onPatch(pane.key, { chatCollapsed: false })
                            : undefined
                    }
                />
            ),
        },
    ];

    return (
        <div className="relative flex min-h-0 min-w-0 flex-1">
            <DockLayout
                panels={dockPanels}
                // * The file and change columns have their own width (dragged) and the chat takes the rest; with the chat folded away they take it all.
                trailingGrows={
                    state.editorVisible && state.chatCollapsed && !filesHidden
                }
                trailingHidden={filesHidden}
                trailingEmpty={!state.editorVisible && treeClosed}
                trailingFirst={treePlacement.placement === 'left'}
                trailing={
                    <CodeViewer
                        alwaysShowEditor
                        treeClosed={treeClosed}
                        onTreeClosedChange={setTreeClosed}
                        chatCollapsed={state.chatCollapsed}
                        treePlacement={treePlacement}
                        toolbarStart={
                            toggleInTree ? treeSidebarToggle : undefined
                        }
                        tabsStart={
                            (state.chatCollapsed && sidebarCollapsed) ||
                            filesLeadWindow
                                ? windowedSidebarToggle
                                : undefined
                        }
                        tabsEnd={
                            state.chatCollapsed ? (
                                <>
                                    {panelsMenu}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t(
                                            'workspace_pane.open_chat_panel',
                                        )}
                                        title={t(
                                            'workspace_pane.open_chat_panel',
                                        )}
                                        onClick={() =>
                                            onPatch(pane.key, {
                                                chatCollapsed: false,
                                            })
                                        }
                                        className="text-muted-foreground"
                                    >
                                        <MessageSquare
                                            aria-hidden="true"
                                            className="size-5"
                                        />
                                    </Button>
                                </>
                            ) : undefined
                        }
                        onAttachFile={(path) =>
                            onPatch(pane.key, {
                                attachFile: {
                                    path,
                                    n: (state.attachFile?.n ?? 0) + 1,
                                },
                            })
                        }
                        openRequest={openRequest}
                        changesRequest={changesRequest}
                        repo={`local:${pane.root}`}
                        repos={[`local:${pane.root}`]}
                        onViewRepo={noViewerChange}
                        changes={[]}
                        assistant={{ name: 'Codexis' }}
                        onInlineAsk={askAssistant(pane.root)}
                        onShowHistory={onShowHistory}
                        onActiveFile={(file) =>
                            onPatch(pane.key, { activeFile: file })
                        }
                        onEditorVisible={(visible) =>
                            onPatch(pane.key, { editorVisible: visible })
                        }
                    />
                }
            >
                <ChangesViewerContext.Provider value={changesViewer}>
                    <ChatPanel
                        root={pane.root}
                        acceptsRemote={active}
                        projects={projects}
                        fill
                        headerStart={
                            sidebarCollapsed &&
                            !filesLeadWindow &&
                            !toggleInTree
                                ? windowedSidebarToggle
                                : null
                        }
                        headerActions={
                            <ChatHeaderActions
                                onOpenInVscode={onOpenInVscode}
                                terminalOpen={terminalOpen}
                                onToggleTerminal={onToggleTerminal}
                                railOpen={railOpen}
                                onToggleRail={toggleRail}
                                filesLabel={filesLabel}
                                filesShown={!filesHidden}
                                onToggleFiles={toggleFiles}
                                menu={panelsMenu}
                            />
                        }
                        canCollapse={!filesHidden}
                        onTooNarrow={() =>
                            onPatch(pane.key, { chatCollapsed: true })
                        }
                        attachFile={state.attachFile}
                        sendRequest={state.sendPrompt}
                        selectedFile={state.activeFile}
                        viewSubagent={state.viewSubagent}
                        onLeaveSubagent={() =>
                            onPatch(pane.key, { viewSubagent: null })
                        }
                        popup={railPopup}
                        onOpenRail={toggleRail}
                        collapsed={
                            state.chatCollapsed &&
                            !filesHidden &&
                            (state.editorVisible || sideChatOpen)
                        }
                        newChat={state.newChat}
                        openConversation={state.picked}
                        onConversation={(id) => {
                            onPatch(pane.key, { conversation: id });
                            onRefreshConversations(pane.root);
                        }}
                        onChanged={() => {
                            onRefreshConversations(pane.root);
                            setRailRefresh((count) => count + 1);
                        }}
                        onContext={setRailContext}
                        onRunningPrompts={(runningPrompts) =>
                            onPatch(pane.key, { runningPrompts })
                        }
                        onSubagents={(subagents) =>
                            onPatch(pane.key, { subagents })
                        }
                    />
                </ChangesViewerContext.Provider>
            </DockLayout>
        </div>
    );
}
