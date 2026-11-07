import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityTerminal } from '@/components/ai-chat/activity-terminal';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { ChatGrid } from '@/components/shell/chat-grid';
import { LoginScreen } from '@/components/shell/accounts';
import { DialogsHost } from '@/components/shell/dialogs-host';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import { Sidebar } from '@/components/shell/sidebar';
import { SidebarToggle } from '@/components/shell/sidebar-toggle';
import { UpdateBanner } from '@/components/shell/update-banner';
import { WorkspacePane } from '@/components/shell/workspace-pane';
import { useFileDropGuard } from '@/hooks/use-file-drop-guard';
import { FRESH, usePaneState } from '@/hooks/use-pane-state';
import { canChat, useAuthStatus } from '@/hooks/use-auth-status';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { useWindowButtonsHover } from '@/hooks/use-window-buttons-hover';
import { useWorkspace } from '@/hooks/use-workspace';
import { errorText, ide } from '@/lib/ide';
import type { GridMember } from '@/lib/ide';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// * The sidebar is either this wide or folded away; only the edge button changes it.
const SIDEBAR_OPEN_WIDTH = 256;
const SIDEBAR_MIN_WIDTH = 120;
// * The chat grid shows at most this many chats (2 × 2); the backend refuses more.
const MAX_GRID = 4;

export default function App() {
    const workspace = useWorkspace();
    const { paneStates, patchPane } = usePaneState();
    const [terminalOpen, setTerminalOpen] = useState(false);
    const [backgroundOpen, setBackgroundOpen] = useState(false);

    const windowButtonsVisible = useWindowButtonsHover();
    useFileDropGuard();

    // * The terminal is sized by dragging its top edge up (or down); the height is kept for next time.
    const terminalHeight = useResizableWidth(
        'ide.height.terminal',
        256,
        96,
        window.innerHeight,
        'y',
    );
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
    // * Chat settings (the open tab) and the AI statistics, both opened from the sidebar's ⋮ menu.
    const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
    const [usageOpen, setUsageOpen] = useState(false);
    const [phoneOpen, setPhoneOpen] = useState(false);
    // * Sign-in of the AI CLIs and GitHub: the app stays behind the login screen until one AI CLI is signed in.
    const auth = useAuthStatus(false);

    // * The chat grids span projects, so they are one list for the whole app, kept in the backend: read at start, read again after each change (it brings the titles). Each chat has its group; a group is shown from two chats on.
    const [grid, setGrid] = useState<GridMember[]>([]);
    const [openGroup, setOpenGroup] = useState<number | null>(null);
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
    const readGrid = useCallback(
        () => {
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
        },
        [applyGrid],
    );
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
    const showGroup = (group: number) => {
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
    // * Full file: the chat is folded away and the editor is shown; the sidebar then floats over the editor instead of pushing it.
    const sidebarOverlay =
        activeState.chatCollapsed && activeState.editorVisible;
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
    const chatProjects = projects.flatMap((project) =>
        project.folders[0] === undefined
            ? []
            : [{ root: project.folders[0], name: project.name }],
    );

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background text-sm text-foreground">
            {/* * Same height as the header (so the two read as one bar) and drawn behind the native window buttons while they are shown; it never takes the pointer, so the page under it stays reachable. */}
            <div
                aria-hidden="true"
                data-testid="window-buttons-bar"
                className={cn(
                    'pointer-events-none fixed top-0 left-0 z-40 h-12 w-24 border-b bg-background transition-transform duration-200 ease-out',
                    windowButtonsVisible
                        ? 'translate-y-0'
                        : '-translate-y-full',
                )}
            />
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
                    {/* * Click outside the floating sidebar closes it. */}
                    {sidebarOverlayOpen && (
                        <div
                            aria-hidden="true"
                            data-testid="sidebar-backdrop"
                            className="fixed inset-0 z-[25]"
                            onClick={toggleSidebar}
                        />
                    )}
                    <div
                        inert={sidebarCollapsed}
                        style={{ width: SIDEBAR_OPEN_WIDTH }}
                        className={cn(
                            'flex shrink-0 overflow-hidden',
                            sidebarOverlay &&
                                'absolute inset-y-0 left-0 z-30 border-r bg-background shadow-lg transition-transform duration-200 ease-out motion-reduce:transition-none',
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
                            subagents={activeState.subagents}
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
                            onOpenSubagent={(id) =>
                                patchPane(activeKey, { viewSubagent: id })
                            }
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
                        />
                    </div>
                </div>
                <main className="flex min-w-0 flex-1 flex-col overflow-clip">
                    {showGrid && (
                        <ChatGrid
                            key={openGroup}
                            members={openMembers}
                            projects={chatProjects}
                            headerStart={
                                sidebarCollapsed ? sidebarToggle : undefined
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
                                    ? 'flex min-h-0 min-w-0 flex-1 flex-col'
                                    : 'hidden'
                            }
                        >
                            <div className="flex min-h-0 min-w-0 flex-1">
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
                                            terminalOpen={terminalOpen}
                                            backgroundOpen={backgroundOpen}
                                            phoneOpen={phoneOpen}
                                            sidebarCollapsed={sidebarCollapsed}
                                            sidebarToggle={sidebarToggle}
                                            onToggleTerminal={() =>
                                                setTerminalOpen((open) => !open)
                                            }
                                            onToggleBackground={() =>
                                                setBackgroundOpen(
                                                    (open) => !open,
                                                )
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
                                            onRefreshConversations={
                                                refreshConversations
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
                            {terminalOpen && activePane !== null && (
                                <div
                                    style={{ height: terminalHeight.width }}
                                    className="relative max-h-[80%] shrink-0 border-t"
                                >
                                    <ResizeHandle
                                        horizontal
                                        label={t('app.resize_terminal_height')}
                                        {...terminalHeight.handleProps}
                                    />
                                    <ActivityTerminal
                                        onClose={() => setTerminalOpen(false)}
                                        root={activePane.root}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </main>
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
