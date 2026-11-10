import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BottomPanel } from '@/components/shell/bottom-panel';
import { FloatingFrame } from '@/components/shell/floating-frame';
import type {
    BottomTab,
    TerminalCommand,
} from '@/components/shell/bottom-panel';
import { ChatGrid } from '@/components/shell/chat-grid';
import { LoginScreen } from '@/components/shell/accounts';
import { DialogsHost } from '@/components/shell/dialogs-host';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import { Sidebar } from '@/components/shell/sidebar';
import { SidebarToggle } from '@/components/shell/sidebar-toggle';
import { UpdateBanner } from '@/components/shell/update-banner';
import { WorkspacePane } from '@/components/shell/workspace-pane';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useActivityEvents } from '@/hooks/use-activity-events';
import { useFileDropGuard } from '@/hooks/use-file-drop-guard';
import { FRESH, usePaneState } from '@/hooks/use-pane-state';
import { canChat, useAuthStatus } from '@/hooks/use-auth-status';
import { usePanelPlacement } from '@/hooks/use-panel-placement';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { useBackgroundTasks } from '@/components/shell/chat/use-background-tasks';
import { useWorkspace } from '@/hooks/use-workspace';
import {
    errorText,
    ide,
    emitBottomState,
    onBottomAction,
    onFileMenu,
    onTerminalMenu,
    onTerminalWindowClosed,
    pickFolders,
} from '@/lib/ide';
import type { GridMember } from '@/lib/ide';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// * The sidebar is either this wide or folded away; only the edge button changes it.
const SIDEBAR_OPEN_WIDTH = 256;
const SIDEBAR_MIN_WIDTH = 120;
// * The chat grid shows at most this many chats (2 × 2); the backend refuses more.
const MAX_GRID = 4;

/** Where the active pane holds the shared bottom panel: the panel's own node is put in here, and taken along when another pane shows it. */
function BottomHostSlot({ host }: { host: HTMLElement }) {
    const attach = useCallback(
        (slot: HTMLDivElement | null) => {
            slot?.appendChild(host);
        },
        [host],
    );

    return <div ref={attach} className="h-full min-h-0" />;
}

export default function App() {
    const workspace = useWorkspace();
    const { paneStates, patchPane } = usePaneState();
    // * The bottom panel: the tab shown, or null when it is closed (the toolbar's Terminal and Background tasks buttons each open it on their own tab).
    const [bottomTab, setBottomTab] = useState<BottomTab | null>(null);
    // * The Terminal menu of the menu bar: opens the Terminal tab and asks it for a new or a split terminal.
    const [terminalCommand, setTerminalCommand] =
        useState<TerminalCommand | null>(null);
    const isBottomOpen = useRef(false);

    useEffect(() => {
        isBottomOpen.current = bottomTab !== null;

        // * A command is carried out once: a panel opened again later does not repeat it.
        if (bottomTab === null) {
            setTerminalCommand(null);
        }
    }, [bottomTab]);

    // * The tab the panel was detached on: while it is set, the whole panel lives in the separate window and the main window shows none.
    const [detachedTab, setDetachedTab] = useState<BottomTab | null>(null);
    const detachedTabRef = useRef<BottomTab | null>(null);

    useEffect(() => {
        detachedTabRef.current = detachedTab;
    }, [detachedTab]);

    // * Shows a tab of the panel: in the separate window when it holds the panel (brought to the front), otherwise in the main window.
    const showBottomTab = useCallback((tab: BottomTab, root?: string) => {
        if (detachedTabRef.current === null) {
            setBottomTab(tab);

            return;
        }

        void ide.terminalWindowOpen(root, tab).catch(() => undefined);
    }, []);
    const activeRootRef = useRef<string | undefined>(undefined);

    useEffect(() => {
        const stop = onTerminalMenu((action) => {
            if (detachedTabRef.current === null) {
                setTerminalCommand({ action, isFresh: !isBottomOpen.current });
            }

            showBottomTab('terminal', activeRootRef.current);
        });

        return () => {
            void stop.then((unlisten) => unlisten());
        };
    }, [showBottomTab]);
    // * File > Open… / Open Folder…: pick folders and add them as a project (the sidebar's "Thêm mới dự án" does the same through its dialog).
    const createdProjectRef = useRef(workspace.createdProject);

    useEffect(() => {
        createdProjectRef.current = workspace.createdProject;
    });

    useEffect(() => {
        const stop = onFileMenu(() => {
            void (async () => {
                try {
                    const folders = await pickFolders();

                    if (folders.length === 0) {
                        return;
                    }

                    const project = await ide.addProject({
                        name:
                            folders[0].split(/[\\/]/).filter(Boolean).pop() ??
                            folders[0],
                        folders,
                        env: [],
                    });

                    createdProjectRef.current(project);
                } catch (caught) {
                    console.error(errorText(caught));
                }
            })();
        });

        return () => {
            void stop.then((unlisten) => unlisten());
        };
    }, []);
    const toggleBottomTab = (tab: BottomTab) =>
        detachedTab === null
            ? setBottomTab((current) => (current === tab ? null : tab))
            : showBottomTab(tab, activeRoot ?? undefined);
    // * The file whose history the Lịch sử tab shows (null: the whole project).
    const [historyPath, setHistoryPath] = useState<string | null>(null);
    const showFileHistory = (path: string | null = null) => {
        setHistoryPath(path);
        showBottomTab('history', activeRoot ?? undefined);
    };
    // * Where the bottom panel sits: under the work area, filling it, or floating over it.
    const bottomPlacement = usePanelPlacement('bottom-panel', 'bottom');

    useFileDropGuard();
    useActivityEvents();
    const isFullscreen = useFullscreen();

    // * Open (256) or folded (1) state of the sidebar, kept between visits; the hook only stores it.
    const sidebarWidth = useResizableWidth(
        'ide.width.sidebar',
        256,
        0,
        480,
        'x',
        'trailing',
    );
    const sidebarCollapsed = sidebarWidth.width < SIDEBAR_MIN_WIDTH;
    // * 1, not 0: a stored 0 reads as "never set" and would bring the sidebar back open on the next start.
    const toggleSidebar = () =>
        sidebarWidth.setTo(sidebarCollapsed ? SIDEBAR_OPEN_WIDTH : 1);

    const {
        projects,
        activeId,
        selected,
        panes,
        view,
        activeKey,
        activePane,
        activeRoot,
        refreshConversations,
    } = workspace;
    const activeState = paneStates[activeKey] ?? FRESH;
    // * One table of background tasks for the open project: the bottom panel lists it (shell commands and sub-agents in their own tabs).
    const background = useBackgroundTasks(activePane?.root);

    useEffect(() => {
        activeRootRef.current = activeRoot ?? undefined;
    }, [activeRoot]);

    // * The separate window holding the panel: what it needs from the chats and the editor comes back here (acting on the pane active now), it is told the prompts running, and closing it brings the panel back on the tab it was detached on.
    const windowBridge = useRef({ patchPane, activeKey, paneStates });

    useEffect(() => {
        windowBridge.current = { patchPane, activeKey, paneStates };
    });
    const runningPromptsKey = JSON.stringify(activeState.runningPrompts);

    useEffect(() => {
        if (detachedTab !== null) {
            void emitBottomState(JSON.parse(runningPromptsKey) as string[]);
        }
    }, [detachedTab, runningPromptsKey]);

    useEffect(() => {
        const stopAction = onBottomAction((action) => {
            const {
                patchPane: patch,
                activeKey: key,
                paneStates: states,
            } = windowBridge.current;

            if (action.kind === 'ready') {
                void emitBottomState(JSON.parse(runningPromptsKey) as string[]);
            } else if (action.kind === 'open-file') {
                patch(key, {
                    openFile: {
                        path: action.path,
                        n: (states[key]?.openFile?.n ?? 0) + 1,
                    },
                });
            } else if (action.kind === 'send-prompt') {
                patch(key, {
                    sendPrompt: {
                        text: action.text,
                        n: (states[key]?.sendPrompt?.n ?? 0) + 1,
                    },
                });
            } else {
                patch(key, { viewSubagent: action.id });
            }
        });
        const stopClosed = onTerminalWindowClosed(() => {
            setBottomTab(detachedTabRef.current ?? 'terminal');
            setDetachedTab(null);
        });

        return () => {
            void stopAction.then((unlisten) => unlisten());
            void stopClosed.then((unlisten) => unlisten());
        };
    }, [runningPromptsKey]);
    // * Chat settings (the open tab) and the AI statistics, both opened from the sidebar's ⋮ menu.
    const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
    const [usageOpen, setUsageOpen] = useState(false);
    const [phoneOpen, setPhoneOpen] = useState(false);
    // * Sign-in of the AI CLIs and GitHub: the app stays behind the login screen until one AI CLI is signed in.
    const auth = useAuthStatus(false);

    // * The chat grids span projects, so they are one list for the whole app, kept in the backend: read at start, read again after each change (it brings the titles). Each chat has its group; a group is shown from two chats on.
    const [grid, setGrid] = useState<GridMember[]>([]);
    const [openGroup, setOpenGroup] = useState<number | null>(null);
    const [focus, setFocus] = useState<{ root: string; n: number } | null>(
        null,
    );
    // * The group the next chat added goes to.
    const [targetGroup, setTargetGroup] = useState(1);
    const targetChosen = useRef(false);
    // * The latest grid, so two quick changes build on each other and not on a stale render; the request counter drops a read that a newer change or read has passed.
    const gridRef = useRef<GridMember[]>([]);
    const gridRequest = useRef(0);
    const applyGrid = useCallback((members: GridMember[]) => {
        gridRef.current = members;
        setGrid(members);
    }, []);
    const readGrid = useCallback(() => {
        const request = ++gridRequest.current;

        void ide
            .chatGridGet()
            .then((members) => {
                if (request !== gridRequest.current) {
                    return;
                }

                applyGrid(members);

                // * At start the next chat goes to the last saved group, not to a group 1 that no longer exists.
                if (!targetChosen.current && members.length > 0) {
                    targetChosen.current = true;
                    setTargetGroup(members[members.length - 1].group);
                }
            })
            .catch(() => undefined);
    }, [applyGrid]);
    useEffect(readGrid, [readGrid]);
    const countIn = (members: GridMember[], group: number) =>
        members.filter((member) => member.group === group).length;
    const saveGrid = (picks: GridMember[], open: number | null) => {
        setOpenGroup(open);
        gridRequest.current += 1;
        applyGrid(picks);
        void ide
            .chatGridSave(
                picks.map((member) => ({
                    group: member.group,
                    root: member.workspace,
                    conversation: member.conversation,
                })),
            )
            .then(readGrid)
            .catch(readGrid);
    };
    // * The group stays open while it still has two chats.
    const stillOpen = (members: GridMember[]) =>
        openGroup !== null && countIn(members, openGroup) >= 2
            ? openGroup
            : null;
    const toggleGrid = (root: string, conversation: number, group: number) => {
        const grid = gridRef.current;

        if (grid.some((member) => member.conversation === conversation)) {
            const rest = grid.filter(
                (member) => member.conversation !== conversation,
            );

            saveGrid(rest, stillOpen(rest));
        } else if (countIn(grid, group) < MAX_GRID) {
            setTargetGroup(group);

            const next = [
                ...grid,
                {
                    group,
                    workspace: root,
                    conversation,
                    title: '',
                },
            ];

            // * The second chat of a group shows it at once.
            saveGrid(next, countIn(next, group) >= 2 ? group : stillOpen(next));
        }
    };
    const removeGridProject = (root: string, group: number) => {
        const rest = gridRef.current.filter(
            (member) => !(member.workspace === root && member.group === group),
        );

        saveGrid(rest, stillOpen(rest));
    };
    const showGroup = (group: number, root?: string) => {
        // * A project row of the group also picks that project's chat, so the file tree follows it.
        setFocus(root === undefined ? null : { root, n: (focus?.n ?? 0) + 1 });
        setOpenGroup(group);
        setTargetGroup(group);
    };
    const newGroup = () =>
        setTargetGroup(
            Math.max(targetGroup, ...grid.map((member) => member.group)) + 1,
        );
    // * Any other pick in the sidebar leaves the grid for the project or chat picked.
    const leaveGrid = () => setOpenGroup(null);
    const openMembers = grid.filter((member) => member.group === openGroup);
    const showGrid = openGroup !== null && openMembers.length >= 2;

    const openInVscode = () =>
        ide
            .openInVscode(
                activeState.activeFile ?? undefined,
                undefined,
                activeRoot ?? undefined,
            )
            .catch((caught) => console.error(errorText(caught)));

    const showPanel = selected && activePane !== null;
    // * The bottom panel is one for the whole app, drawn into a node of its own that the active pane takes in under its editor (never under the chat): switching project moves the node, so the terminals are not closed.
    const [bottomHost] = useState(() => {
        const host = document.createElement('div');

        host.className = 'h-full min-h-0';

        return host;
    });
    const isBottomDocked = bottomPlacement.placement === 'bottom';
    const bottomPanel =
        bottomTab !== null && activePane !== null ? (
            <BottomPanel
                tab={bottomTab}
                root={activePane.root}
                background={background}
                placement={bottomPlacement.placement}
                dockedPlacement={bottomPlacement.dockedPlacement}
                onPlacementChange={bottomPlacement.setPlacement}
                onSaveDefault={bottomPlacement.saveAsDefault}
                onResetDefault={bottomPlacement.resetToDefault}
                historyPath={historyPath}
                onClearHistoryPath={() => setHistoryPath(null)}
                onTabChange={setBottomTab}
                onClose={() => setBottomTab(null)}
                onDetach={() => {
                    const tab = bottomTab;

                    void ide
                        .terminalWindowOpen(activePane.root, tab)
                        .then(() => {
                            setDetachedTab(tab);
                            setBottomTab(null);
                        })
                        .catch((caught) => console.error(errorText(caught)));
                }}
                terminalCommand={terminalCommand}
                onOpenFile={(path) =>
                    patchPane(activeKey, {
                        openFile: {
                            path,
                            n: (paneStates[activeKey]?.openFile?.n ?? 0) + 1,
                        },
                    })
                }
                runningPrompts={activeState.runningPrompts}
                onSendPrompt={(text) =>
                    patchPane(activeKey, {
                        sendPrompt: {
                            text,
                            n: (paneStates[activeKey]?.sendPrompt?.n ?? 0) + 1,
                        },
                    })
                }
                onOpenSubagent={(id) =>
                    patchPane(activeKey, {
                        viewSubagent: id,
                    })
                }
            />
        ) : null;
    // * The sidebar always floats over the content (absolute) instead of pushing it.
    const sidebarOverlay = true;
    const sidebarOverlayOpen = sidebarOverlay && !sidebarCollapsed;

    // * Escape folds the floating sidebar.
    useEffect(() => {
        if (!sidebarOverlayOpen) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                sidebarWidth.setTo(1);
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [sidebarOverlayOpen, sidebarWidth]);

    if (auth.statuses === null || !canChat(auth.statuses)) {
        return (
            <LoginScreen
                statuses={auth.statuses}
                error={auth.error}
                onChanged={() => void auth.refresh()}
            />
        );
    }

    const sidebarToggle = (
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
    );
    // * Folded, the toggle heads the first header bar, so it starts after the three native window buttons (hidden in fullscreen).
    const foldedSidebarToggle = (
        <span className={cn('flex', !isFullscreen && 'pl-16')}>
            {sidebarToggle}
        </span>
    );
    const chatProjects = projects.flatMap((project) =>
        project.folders[0] === undefined
            ? []
            : [{ root: project.folders[0], name: project.name }],
    );

    // * fixed inset-0, not h-screen: in native fullscreen 100vh can be taller than the visible area (the notch inset) and push the bottom of the layout off the screen.
    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-sm text-foreground">
            <div className="flex min-h-0 flex-1 overflow-clip">
                {/* * The sidebar stays mounted at the width the user dragged it to; `inert` keeps the folded one out of focus. */}
                <div
                    style={{
                        width:
                            sidebarCollapsed || sidebarOverlay
                                ? 0
                                : SIDEBAR_OPEN_WIDTH,
                    }}
                    className={cn(
                        // * Folding or unfolding slides the sidebar: the room it takes grows or shrinks, and the sidebar itself stays at its full width, so its content is revealed and not squeezed. Floating over the editor, it slides in from the edge instead.
                        'group relative flex shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none',
                        !sidebarOverlay && 'overflow-hidden',
                    )}
                >
                    {/* * Click outside the floating sidebar closes it; the backdrop fades in and out with the slide. */}
                    {sidebarOverlay && (
                        <div
                            aria-hidden="true"
                            data-testid="sidebar-backdrop"
                            className={cn(
                                'fixed inset-0 z-[25] bg-black/30 transition-opacity duration-200 ease-out motion-reduce:transition-none',
                                sidebarOverlayOpen
                                    ? 'opacity-100'
                                    : 'pointer-events-none opacity-0',
                            )}
                            onClick={toggleSidebar}
                        />
                    )}
                    <div
                        inert={sidebarCollapsed}
                        style={{ width: SIDEBAR_OPEN_WIDTH }}
                        className={cn(
                            'flex shrink-0 overflow-hidden',
                            sidebarOverlay &&
                                'absolute inset-y-0 left-0 z-30 border-r bg-background shadow-lg transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                            sidebarOverlay &&
                                sidebarCollapsed &&
                                'pointer-events-none -translate-x-full shadow-none',
                        )}
                    >
                        <Sidebar
                            projects={projects}
                            activeId={activeId}
                            startupName={
                                workspace.startupHidden ? null : workspace.name
                            }
                            selected={selected}
                            error={workspace.error}
                            onSelect={(id) => {
                                leaveGrid();
                                void workspace.selectProject(id);
                            }}
                            onSelectStartup={() => {
                                leaveGrid();
                                workspace.select();
                            }}
                            onCreated={workspace.createdProject}
                            onRemove={(id) =>
                                id === null
                                    ? workspace.removeStartup()
                                    : void workspace.removeProject(id)
                            }
                            conversations={workspace.conversations}
                            currentConversation={activeState.conversation}
                            onOpenConversation={(id) => {
                                leaveGrid();
                                // * Picking a chat opens the chat pane too, even when a file had folded it away.
                                patchPane(activeKey, {
                                    picked: {
                                        id,
                                        n: (activeState.picked?.n ?? 0) + 1,
                                    },
                                    chatCollapsed: false,
                                });
                            }}
                            activeRoot={activeRoot}
                            grid={grid}
                            openGroup={showGrid ? openGroup : null}
                            targetGroup={targetGroup}
                            maxGrid={MAX_GRID}
                            onToggleGrid={toggleGrid}
                            onOpenGroup={showGroup}
                            onNewGroup={newGroup}
                            onRemoveGridProject={removeGridProject}
                            onDeleteConversation={(id) =>
                                void ide
                                    .chatDelete(id, activeRoot ?? undefined)
                                    .then(() => {
                                        if (activeRoot !== null) {
                                            refreshConversations(activeRoot);
                                            readGrid();
                                        }

                                        if (id === activeState.conversation) {
                                            patchPane(activeKey, {
                                                newChat:
                                                    activeState.newChat + 1,
                                            });
                                        }
                                    })
                                    .catch(() => undefined)
                            }
                            onNewChat={() => {
                                leaveGrid();
                                // * A new chat opens the chat pane at once, even when a file had folded it away.
                                patchPane(activeKey, {
                                    newChat: activeState.newChat + 1,
                                    chatCollapsed: false,
                                });
                            }}
                            onOpenSettings={setSettingsTab}
                            onOpenUsage={() => setUsageOpen(true)}
                            toggle={sidebarToggle}
                            hasWindowButtons={!isFullscreen}
                        />
                    </div>
                </div>
                <main className="flex min-w-0 flex-1 flex-col overflow-clip">
                    {showGrid && (
                        <ChatGrid
                            key={openGroup}
                            members={openMembers}
                            focus={focus}
                            projects={chatProjects}
                            headerStart={
                                sidebarCollapsed
                                    ? foldedSidebarToggle
                                    : undefined
                            }
                            onChanged={refreshConversations}
                        />
                    )}
                    {!showPanel && !showGrid && (
                        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                            {t('app.pick_aproject_to')}
                        </div>
                    )}
                    {panes.length > 0 && (
                        <div
                            className={
                                showPanel && !showGrid
                                    ? 'relative flex min-h-0 min-w-0 flex-1 flex-col'
                                    : 'hidden'
                            }
                        >
                            <div
                                className={cn(
                                    'min-h-0 min-w-0 flex-1',
                                    bottomTab !== null &&
                                        bottomPlacement.placement === 'fill'
                                        ? 'hidden'
                                        : 'flex',
                                )}
                            >
                                {panes.map((pane) => (
                                    <div
                                        key={pane.key}
                                        className={
                                            view.includes(pane.key)
                                                ? 'flex min-h-0 min-w-0 flex-1'
                                                : 'hidden'
                                        }
                                    >
                                        <WorkspacePane
                                            pane={pane}
                                            state={
                                                paneStates[pane.key] ?? FRESH
                                            }
                                            active={pane.key === activeKey}
                                            projects={chatProjects}
                                            terminalOpen={
                                                bottomTab === 'terminal'
                                            }
                                            backgroundOpen={
                                                bottomTab === 'background'
                                            }
                                            plansOpen={bottomTab === 'plans'}
                                            phoneOpen={phoneOpen}
                                            sidebarCollapsed={sidebarCollapsed}
                                            sidebarToggle={sidebarToggle}
                                            hasWindowButtons={!isFullscreen}
                                            bottomPanel={
                                                pane.key === activeKey &&
                                                bottomPanel !== null &&
                                                isBottomDocked ? (
                                                    <BottomHostSlot
                                                        host={bottomHost}
                                                    />
                                                ) : null
                                            }
                                            onToggleTerminal={() =>
                                                toggleBottomTab('terminal')
                                            }
                                            onToggleBackground={() =>
                                                toggleBottomTab('background')
                                            }
                                            onTogglePlans={() =>
                                                toggleBottomTab('plans')
                                            }
                                            onOpenSettings={() =>
                                                setSettingsTab('advanced')
                                            }
                                            onOpenPhone={() =>
                                                setPhoneOpen(true)
                                            }
                                            onOpenInVscode={() =>
                                                void openInVscode()
                                            }
                                            onPatch={patchPane}
                                            onShowHistory={showFileHistory}
                                            onRefreshConversations={
                                                refreshConversations
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
                            {bottomTab !== null &&
                                activePane !== null &&
                                !isBottomDocked && (
                                    <FloatingFrame
                                        storageKey="ide.float.bottom"
                                        enabled={
                                            bottomPlacement.placement ===
                                            'float'
                                        }
                                        className={cn(
                                            'relative',
                                            bottomPlacement.placement ===
                                                'float' &&
                                                'absolute right-3 bottom-3 z-30 h-80 max-h-[80%] w-[min(48rem,calc(100%-1.5rem))] overflow-hidden rounded-lg border shadow-xl',
                                            bottomPlacement.placement ===
                                                'fill' && 'min-h-0 flex-1',
                                        )}
                                    >
                                        {bottomPanel}
                                    </FloatingFrame>
                                )}
                        </div>
                    )}
                </main>
                {isBottomDocked &&
                    bottomPanel !== null &&
                    createPortal(bottomPanel, bottomHost)}
                <DialogsHost
                    settingsTab={settingsTab}
                    onSettingsTabChange={setSettingsTab}
                    usageOpen={usageOpen}
                    onUsageClose={() => setUsageOpen(false)}
                    phoneOpen={phoneOpen}
                    onPhoneClose={() => setPhoneOpen(false)}
                />
            </div>
            <UpdateBanner />
        </div>
    );
}
