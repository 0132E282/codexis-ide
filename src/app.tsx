import {
    Code2,
    MessageSquare,
    PanelLeftClose,
    PanelLeftOpen,
    Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityTerminal,
    type ActivityEntry,
} from '@/components/ai-chat/activity-terminal';
import { LocalBranchPopover } from '@/components/ai-chat/branch-popover';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { LoginScreen } from '@/components/shell/accounts';
import { ChatPanel } from '@/components/shell/chat-panel';
import { SettingsDialog } from '@/components/shell/settings-dialog';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import { Sidebar } from '@/components/shell/sidebar';
import { UsageDialog } from '@/components/shell/usage-dialog';
import { Button } from '@/components/ui/button';
import { canChat, useAuthStatus } from '@/hooks/use-auth-status';
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

const NOT_AVAILABLE = 'Chưa có trong IDE.';

// * No assistant is wired: the viewer's "Hỏi AI về đoạn này" box opens, and its answer is the honest "not in the IDE" failure of the api stand-in.
const askAssistant = async () =>
    (await api.post<InlineAnswer>('/ai-chat/inline-ask')).data;

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
};

const FRESH: PaneState = {
    editorVisible: false,
    activeFile: null,
    newChat: 0,
    picked: null,
    conversation: null,
    subagents: [],
    chatCollapsed: false,
};

// * Key of the pane of the start-up workspace, which is not a saved project.
const STARTUP_KEY = 'startup';

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
    // * A display preference, kept in localStorage (it can be blocked: the sidebar then simply starts open).
    const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
        try {
            return localStorage.getItem('codexis.sidebar-collapsed') === '1';
        } catch {
            return false;
        }
    });
    const setSidebarCollapsed = (collapsed: boolean) => {
        setSidebarCollapsedState(collapsed);

        try {
            localStorage.setItem(
                'codexis.sidebar-collapsed',
                collapsed ? '1' : '0',
            );
        } catch {
            // * Storage blocked: the choice still applies for this visit.
        }
    };
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
    // * Sign-in of the AI CLIs and GitHub: the app stays behind the login screen until one AI CLI is signed in.
    const auth = useAuthStatus(false);
    const [entries, setEntries] = useState<ActivityEntry[]>([]);
    const entryId = useRef(0);

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

    // * No shell backend exists: a typed command is echoed like a shell line and answered with the honest "not in the IDE" failure.
    const runCommand = useCallback(async (command: string) => {
        const time = new Date().toLocaleTimeString('vi-VN');

        setEntries((current) => [
            ...current,
            {
                id: entryId.current++,
                time,
                level: 'info',
                text: `$ ${command}`,
            },
            {
                id: entryId.current++,
                time,
                level: 'error',
                text: NOT_AVAILABLE,
            },
        ]);
    }, []);

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

    // * Folds the sidebar away or opens it again; shown in the bar of the chat (or beside the closed chat).
    const sidebarToggle = (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={sidebarCollapsed ? 'Mở thanh bên' : 'Thu gọn thanh bên'}
            title={sidebarCollapsed ? 'Mở thanh bên' : 'Thu gọn thanh bên'}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="text-muted-foreground"
        >
            {sidebarCollapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-5" />
            ) : (
                <PanelLeftClose aria-hidden="true" className="size-5" />
            )}
        </Button>
    );

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background text-sm text-foreground">
            <div className="flex min-h-0 flex-1 overflow-hidden">
                {!sidebarCollapsed && (
                    <Sidebar
                        projects={projects}
                        activeId={activeId}
                        startupName={name}
                        selected={selected}
                        error={error}
                        onSelect={(id) => void selectProject(id)}
                        onSelectStartup={select}
                        onCreated={createdProject}
                        onRemove={(id) => void removeProject(id)}
                        conversations={conversations}
                        currentConversation={activeState.conversation}
                        subagents={activeState.subagents}
                        onOpenConversation={(id) =>
                            patchPane(activeKey, { picked: id })
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
                                            newChat: activeState.newChat + 1,
                                        });
                                    }
                                })
                                .catch(() => undefined)
                        }
                        onNewChat={() =>
                            patchPane(activeKey, {
                                newChat: activeState.newChat + 1,
                            })
                        }
                        onOpenSettings={setSettingsTab}
                        onOpenUsage={() => setUsageOpen(true)}
                    />
                )}
                <main className="flex min-w-0 flex-1 flex-col">
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
                                                    </>
                                                }
                                                onTooNarrow={() =>
                                                    patchPane(pane.key, {
                                                        chatCollapsed: true,
                                                    })
                                                }
                                                headerStart={sidebarToggle}
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
                                            {state.chatCollapsed &&
                                                state.editorVisible && (
                                                    <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r pt-2">
                                                        {sidebarToggle}
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
                                                    </div>
                                                )}
                                            <CodeViewer
                                                chatCollapsed={
                                                    state.chatCollapsed
                                                }
                                                repo={`local:${pane.root}`}
                                                repos={[`local:${pane.root}`]}
                                                onViewRepo={noViewerChange}
                                                changes={[]}
                                                assistant={{ name: 'Rynox' }}
                                                onInlineAsk={askAssistant}
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
                                <div className="h-64 shrink-0 border-t">
                                    <ActivityTerminal
                                        entries={entries}
                                        onClear={() => setEntries([])}
                                        onClose={() => setTerminalOpen(false)}
                                        onRun={runCommand}
                                        name={activePane.name}
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
            </div>
        </div>
    );
}
