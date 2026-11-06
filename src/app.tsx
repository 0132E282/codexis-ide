import {
    Code2,
    MessageSquare,
    PanelLeftClose,
    PanelLeftOpen,
    Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityTerminal } from '@/components/ai-chat/activity-terminal';
import { LocalBranchPopover } from '@/components/ai-chat/branch-popover';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { LoginScreen } from '@/components/shell/accounts';
import { ChatPanel } from '@/components/shell/chat-panel';
import { SettingsDialog } from '@/components/shell/settings-dialog';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import { Sidebar } from '@/components/shell/sidebar';
import { ConnectPhoneDialog } from '@/components/shell/connect-phone-dialog';
import { UsageDialog } from '@/components/shell/usage-dialog';
import { Button } from '@/components/ui/button';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { canChat, useAuthStatus } from '@/hooks/use-auth-status';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { api } from '@/lib/api';
import {
    errorText,
    ide,
    type ChatConversation,
    type Project,
    type ProjectInfo,
    type Subagent,
} from '@/lib/ide';
import { cn } from '@/lib/utils';

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

/** A project whose chat and viewer are open: they stay mounted (hidden) while another project is shown, so tabs, unsaved edits and the chat survive the switch. */
type Pane = { key: string; root: string; name: string };

/** What one pane remembers for itself. */
type PaneState = {
    /** No file and no change list open: the chat takes the room the editor would have. */
    editorVisible: boolean;
    activeFile: string | null;
    /** Counter bumped by "Cuộc trò chuyện mới". */
    newChat: number;
    /** Conversation picked in the sidebar. */
    picked: number | null;
    /** Conversation shown. */
    conversation: number | null;
    /** Sub-agents the AI has started in the running turn. */
    subagents: Subagent[];
    /** The chat was closed by dragging the editor columns over it. */
    chatCollapsed: boolean;
    /** The sub-agent picked in the sidebar (`n` changes on every pick). */
    viewSubagent: string | null;
    /** A file double-clicked in the tree, for the chat to attach (`n` changes on every click). */
    attachFile: { path: string; n: number } | null;
};

const FRESH: PaneState = {
    chatCollapsed: false,
    editorVisible: false,
    activeFile: null,
    newChat: 0,
    picked: null,
    conversation: null,
    subagents: [],
    viewSubagent: null,
    attachFile: null,
};

// * Key of the pane of the start-up workspace, which is not a saved project.
const STARTUP_KEY = 'startup';
// * The sidebar is either this wide or folded away; only the edge button changes it.
const SIDEBAR_OPEN_WIDTH = 256;
const SIDEBAR_MIN_WIDTH = 120;

export default function App() {
    const [name, setName] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState(false);
    const [panes, setPanes] = useState<Pane[]>([]);
    const [paneStates, setPaneStates] = useState<Record<string, PaneState>>({});
    // * Keys of the panes on screen.
    const [view, setView] = useState<string[]>([]);
    const [terminalOpen, setTerminalOpen] = useState(false);

    // * The three native window buttons stay hidden until the pointer reaches the top-left corner; the page is only watched, never covered, so the buttons under it stay clickable.
    useEffect(() => {
        let shown = false;

        const onMove = (event: MouseEvent) => {
            // * Shown by touching the very top edge, kept while the pointer stays over the buttons: the toggle icon under them can still be reached from below.
            const near =
                event.clientX < 96 && event.clientY < (shown ? 36 : 12);

            if (near !== shown) {
                shown = near;
                void ide.windowButtonsVisible(near).catch(() => undefined);
            }
        };

        window.addEventListener('mousemove', onMove);

        return () => window.removeEventListener('mousemove', onMove);
    }, []);
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
    // * Conversations of the open project (listed under it in the sidebar).
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const activeKey = activeId ?? STARTUP_KEY;
    const activePane = panes.find((pane) => pane.key === activeKey) ?? null;
    const activeState = paneStates[activeKey] ?? FRESH;
    const activeRoot = activePane?.root ?? null;
    const activeRootRef = useRef<string | null>(null);

    activeRootRef.current = activeRoot;

    // * A late answer for a project that is no longer the open one is dropped.
    const refreshConversations = useCallback(
        (root: string) =>
            void ide
                .chatList(root)
                .then((list) => {
                    if (root === activeRootRef.current) {
                        setConversations(list);
                    }
                })
                .catch(() => undefined),
        [],
    );
    // * Chat settings (the open tab) and the AI statistics, both opened from the sidebar's ⋮ menu.
    const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
    const [usageOpen, setUsageOpen] = useState(false);
    const [phoneOpen, setPhoneOpen] = useState(false);
    // * Sign-in of the AI CLIs and GitHub: the app stays behind the login screen until one AI CLI is signed in.
    const auth = useAuthStatus(false);

    const patchPane = useCallback(
        (key: string, change: Partial<PaneState>) =>
            setPaneStates((current) => {
                const before = current[key] ?? FRESH;
                const same = (Object.keys(change) as (keyof PaneState)[]).every(
                    (field) => before[field] === change[field],
                );

                return same
                    ? current
                    : { ...current, [key]: { ...before, ...change } };
            }),
        [],
    );

    const openPane = (key: string, info: ProjectInfo) =>
        setPanes((current) =>
            current.some((pane) => pane.key === key)
                ? current
                : [...current, { key, root: info.root, name: info.name }],
        );

    // * Files dragged in from outside the app are refused: left alone, the webview would navigate to the dropped file. Drags inside the app (tabs, lists) carry no files and are not touched.
    useEffect(() => {
        const refuse = (event: DragEvent) => {
            if (event.dataTransfer?.types.includes('Files')) {
                event.preventDefault();

                if (event.dataTransfer !== null) {
                    event.dataTransfer.dropEffect = 'none';
                }
            }
        };

        window.addEventListener('dragover', refuse);
        window.addEventListener('drop', refuse);

        return () => {
            window.removeEventListener('dragover', refuse);
            window.removeEventListener('drop', refuse);
        };
    }, []);

    useEffect(() => {
        Promise.all([ide.info(), ide.projects()])
            .then(([info, saved]) => {
                setName(info.name);
                setProjects(saved.projects);
                setActiveId(saved.selected);
                openPane(saved.selected ?? STARTUP_KEY, info);
                setView([saved.selected ?? STARTUP_KEY]);
                // * Code is the only view: open the workspace right away.
                setSelected(true);
            })
            .catch((caught) => setError(errorText(caught)));
    }, []);

    useEffect(() => {
        if (activeRoot !== null) {
            refreshConversations(activeRoot);
        }
    }, [activeRoot, refreshConversations]);

    // * A pane already on screen stays where it is (split screen); any other replaces the screen.
    const showAlone = (key: string) =>
        setView((current) => (current.includes(key) ? current : [key]));

    // * The start-up workspace: shown again with a pane of its own when none is open for it.
    const select = () => {
        setSelected(true);
        showAlone(activeKey);

        if (!panes.some((pane) => pane.key === activeKey)) {
            void ide
                .info()
                .then((info) => {
                    setName(info.name);
                    openPane(activeKey, info);
                })
                .catch((caught) => console.error(errorText(caught)));
        }
    };

    const selectProject = (id: string) =>
        ide
            .selectProject(id)
            .then((info) => {
                setName(info.name);
                setActiveId(id);
                openPane(id, info);
                showAlone(id);
                setSelected(true);
            })
            .catch((caught) => console.error(errorText(caught)));

    const createdProject = (project: Project) => {
        // * Adding folders that are already a project hands that project back: only switch to it.
        setProjects((current) =>
            current.some((known) => known.id === project.id)
                ? current
                : [...current, project],
        );
        void selectProject(project.id);
    };

    // * The startup folder (listed while no project is saved) is only hidden: there is nothing saved to remove.
    const [startupHidden, setStartupHidden] = useState(false);
    const removeStartup = () => {
        setStartupHidden(true);
        setPanes((current) =>
            current.filter((pane) => pane.key !== STARTUP_KEY),
        );
        setView((current) => current.filter((key) => key !== STARTUP_KEY));

        if (activeId === null) {
            setSelected(false);
        }
    };

    const removeProject = (id: string) =>
        ide
            .removeProject(id)
            .then(() => {
                setProjects((current) =>
                    current.filter((project) => project.id !== id),
                );
                setPanes((current) =>
                    current.filter((pane) => pane.key !== id),
                );
                setView((current) => current.filter((key) => key !== id));

                if (id === activeId) {
                    setActiveId(null);
                    setSelected(false);
                }
            })
            .catch((caught) => console.error(errorText(caught)));

    const openInVscode = () =>
        ide
            .openInVscode(
                activeState.activeFile ?? undefined,
                undefined,
                activeRoot ?? undefined,
            )
            .catch((caught) => console.error(errorText(caught)));

    const noViewerChange = useCallback(() => undefined, []);
    const showPanel = selected && activePane !== null;

    if (auth.statuses === null || !canChat(auth.statuses)) {
        return (
            <LoginScreen
                statuses={auth.statuses}
                error={auth.error}
                onChanged={() => void auth.refresh()}
            />
        );
    }

    // * A plain icon, like an editor's panel toggle: it ends the right side of the chat header (or of the file tab bar while the chat is folded).
    const sidebarToggle = (
        <button
            type="button"
            aria-label={sidebarCollapsed ? 'Mở thanh bên' : 'Thu gọn thanh bên'}
            title={sidebarCollapsed ? 'Mở thanh bên' : 'Thu gọn thanh bên'}
            onClick={toggleSidebar}
            className={cn(
                'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            )}
        >
            {sidebarCollapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-5" />
            ) : (
                <PanelLeftClose aria-hidden="true" className="size-5" />
            )}
        </button>
    );

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background text-sm text-foreground">
            <div className="flex min-h-0 flex-1 overflow-clip">
                {/* * The sidebar stays mounted at the width the user dragged it to; `inert` keeps the folded one out of focus. */}
                <div
                    style={{ width: sidebarCollapsed ? 0 : SIDEBAR_OPEN_WIDTH }}
                    className="group relative flex shrink-0"
                >
                    <div
                        inert={sidebarCollapsed}
                        className="flex w-full overflow-hidden"
                    >
                        <Sidebar
                            projects={projects}
                            activeId={activeId}
                            startupName={startupHidden ? null : name}
                            selected={selected}
                            error={error}
                            onSelect={(id) => void selectProject(id)}
                            onSelectStartup={select}
                            onCreated={createdProject}
                            onRemove={(id) =>
                                id === null
                                    ? removeStartup()
                                    : void removeProject(id)
                            }
                            conversations={conversations}
                            currentConversation={activeState.conversation}
                            subagents={activeState.subagents}
                            onOpenConversation={(id) =>
                                // * Picking a chat opens the chat pane too, even when a file had folded it away.
                                patchPane(activeKey, {
                                    picked: id,
                                    chatCollapsed: false,
                                })
                            }
                            onOpenSubagent={(id) =>
                                patchPane(activeKey, { viewSubagent: id })
                            }
                            onDeleteConversation={(id) =>
                                void ide
                                    .chatDelete(id, activeRoot ?? undefined)
                                    .then(() => {
                                        if (activeRoot !== null) {
                                            refreshConversations(activeRoot);
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
                            onNewChat={() =>
                                // * A new chat opens the chat pane at once, even when a file had folded it away.
                                patchPane(activeKey, {
                                    newChat: activeState.newChat + 1,
                                    chatCollapsed: false,
                                })
                            }
                            onOpenSettings={setSettingsTab}
                            onOpenUsage={() => setUsageOpen(true)}
                            onConnectPhone={() => setPhoneOpen(true)}
                        />
                    </div>
                </div>
                <main className="flex min-w-0 flex-1 flex-col overflow-clip">
                    {!showPanel && (
                        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                            Chọn một dự án để bắt đầu.
                        </div>
                    )}
                    {panes.length > 0 && (
                        <div
                            className={
                                showPanel
                                    ? 'flex min-h-0 min-w-0 flex-1 flex-col'
                                    : 'hidden'
                            }
                        >
                            <div className="flex min-h-0 min-w-0 flex-1">
                                {panes.map((pane) => {
                                    const state = paneStates[pane.key] ?? FRESH;

                                    return (
                                        <div
                                            key={pane.key}
                                            className={
                                                view.includes(pane.key)
                                                    ? 'flex min-h-0 min-w-0 flex-1'
                                                    : 'hidden'
                                            }
                                        >
                                            <ChatPanel
                                                root={pane.root}
                                                acceptsRemote={
                                                    pane.key === activeKey
                                                }
                                                projects={projects.flatMap(
                                                    (project) =>
                                                        project.folders[0] ===
                                                        undefined
                                                            ? []
                                                            : [
                                                                  {
                                                                      root: project
                                                                          .folders[0],
                                                                      name: project.name,
                                                                  },
                                                              ],
                                                )}
                                                fill={!state.editorVisible}
                                                headerActions={
                                                    <>
                                                        <LocalBranchPopover
                                                            root={pane.root}
                                                        />
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label="Mở trong VS Code"
                                                            title="Mở trong VS Code"
                                                            onClick={() =>
                                                                void openInVscode()
                                                            }
                                                            className="text-muted-foreground"
                                                        >
                                                            <Code2
                                                                aria-hidden="true"
                                                                className="size-5"
                                                            />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label="Terminal"
                                                            aria-pressed={
                                                                terminalOpen
                                                            }
                                                            onClick={() =>
                                                                setTerminalOpen(
                                                                    (open) =>
                                                                        !open,
                                                                )
                                                            }
                                                            className={cn(
                                                                'text-muted-foreground',
                                                                terminalOpen &&
                                                                    'bg-accent text-accent-foreground',
                                                            )}
                                                        >
                                                            <Terminal
                                                                aria-hidden="true"
                                                                className="size-5"
                                                            />
                                                        </Button>
                                                        {/* * The sidebar toggle ends this row, on the right. */}
                                                        {sidebarToggle}
                                                    </>
                                                }
                                                onTooNarrow={() =>
                                                    patchPane(pane.key, {
                                                        chatCollapsed: true,
                                                    })
                                                }
                                                attachFile={state.attachFile}
                                                viewSubagent={
                                                    state.viewSubagent
                                                }
                                                onLeaveSubagent={() =>
                                                    patchPane(pane.key, {
                                                        viewSubagent: null,
                                                    })
                                                }
                                                collapsed={
                                                    state.chatCollapsed &&
                                                    state.editorVisible
                                                }
                                                newChat={state.newChat}
                                                openConversation={state.picked}
                                                onConversation={(id) => {
                                                    patchPane(pane.key, {
                                                        conversation: id,
                                                    });
                                                    refreshConversations(
                                                        pane.root,
                                                    );
                                                }}
                                                onChanged={() =>
                                                    refreshConversations(
                                                        pane.root,
                                                    )
                                                }
                                                onSubagents={(subagents) =>
                                                    patchPane(pane.key, {
                                                        subagents,
                                                    })
                                                }
                                            />
                                            <CodeViewer
                                                chatCollapsed={
                                                    state.chatCollapsed
                                                }
                                                tabsEnd={
                                                    state.chatCollapsed ? (
                                                        <>
                                                            {sidebarCollapsed &&
                                                                sidebarToggle}
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                aria-label="Mở khung chat"
                                                                title="Mở khung chat"
                                                                onClick={() =>
                                                                    patchPane(
                                                                        pane.key,
                                                                        {
                                                                            chatCollapsed: false,
                                                                        },
                                                                    )
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
                                                    patchPane(pane.key, {
                                                        attachFile: {
                                                            path,
                                                            n:
                                                                (state
                                                                    .attachFile
                                                                    ?.n ?? 0) +
                                                                1,
                                                        },
                                                    })
                                                }
                                                repo={`local:${pane.root}`}
                                                repos={[`local:${pane.root}`]}
                                                onViewRepo={noViewerChange}
                                                changes={[]}
                                                assistant={{ name: 'Rynox' }}
                                                onInlineAsk={askAssistant(
                                                    pane.root,
                                                )}
                                                onActiveFile={(file) =>
                                                    patchPane(pane.key, {
                                                        activeFile: file,
                                                    })
                                                }
                                                onEditorVisible={(visible) =>
                                                    patchPane(pane.key, {
                                                        editorVisible: visible,
                                                    })
                                                }
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            {terminalOpen && activePane !== null && (
                                <div
                                    style={{ height: terminalHeight.width }}
                                    className="relative max-h-[80%] shrink-0 border-t"
                                >
                                    <ResizeHandle
                                        horizontal
                                        label="Đổi chiều cao terminal"
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
                <SettingsDialog
                    tab={settingsTab}
                    onTabChange={setSettingsTab}
                    onClose={() => setSettingsTab(null)}
                />
                <UsageDialog
                    open={usageOpen}
                    onClose={() => setUsageOpen(false)}
                />
                <ConnectPhoneDialog
                    open={phoneOpen}
                    onClose={() => setPhoneOpen(false)}
                />
            </div>
        </div>
    );
}
