import {
    ClipboardList,
    Code2,
    LayoutGrid,
    ListChecks,
    MessageSquare,
    MessagesSquare,
    SquareMenu,
    Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { ChatPanel } from '@/components/shell/chat-panel';
import { useSideChat } from '@/components/shell/chat/use-side-chat';
import { DockLayout } from '@/components/shell/dock-layout';
import type { DockPanel } from '@/components/shell/dock-layout';
import { PanelMenu } from '@/components/shell/panel-menu';
import { PanelsMenu } from '@/components/shell/panels-menu';
import { PlanDock } from '@/components/shell/plan-dock';
import type { PlanData } from '@/components/shell/plan-pane';
import { RailPopup } from '@/components/shell/rail-popup';
import { SessionRail } from '@/components/shell/session-rail';
import { SideChatDock } from '@/components/shell/side-chat-dock';
import type { ContextUsage } from '@/components/shell/context-panel';
import { Button } from '@/components/ui/button';
import type { Pane, PaneState } from '@/hooks/use-pane-state';
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
    const planPlacement = usePanelPlacement('plan', 'right');
    // * The session rail: open or not, the context usage the chat reports, a counter bumped when a turn was saved (the rail reads files, branch and pull request again) and the file the rail asked the viewer to open.
    const [railOpen, setRailOpen] = useState(false);
    // * Left of the editor moves the whole file area (tree and editor, with the Multichat under them) in front of the main chat.
    const treePlacement = usePanelPlacement('file-tree', 'right');
    const [railContext, setRailContext] = useState<ContextUsage | null>(null);
    const [railRefresh, setRailRefresh] = useState(0);
    const [openRequest, setOpenRequest] = useState<{
        repo: string;
        path: string;
        id: number;
    } | null>(null);
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

    const toggleRail = () => setRailOpen((open) => !open);
    // * Alone: no file shown and the main chat folded away, so the side chat takes the whole area; any panel coming back puts it in its column again.
    const sideChatAlone =
        sideChatOpen && !state.editorVisible && state.chatCollapsed;
    const toggleSideChat = () => setSideChatOpen((open) => !open);
    // * The plan of the open conversation (from the chat), and whether the Plan pane is open; a plan that arrives while it is closed leaves a dot on its button.
    const [plan, setPlan] = useState<PlanData | null>(null);
    const [planOpen, setPlanOpen] = useState(false);
    const [planUnseen, setPlanUnseen] = useState(false);
    const togglePlan = () => {
        setPlanOpen((open) => !open);
        setPlanUnseen(false);
    };
    const changePlan = (next: PlanData | null) => {
        setPlan(next);
        setPlanUnseen(next !== null && !planOpen);
    };

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
            unseen={planUnseen}
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
                {
                    id: 'plan',
                    icon: ClipboardList,
                    label: t('plan_pane.title'),
                    open: planOpen,
                    onToggle: togglePlan,
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
                    onClose={() => setRailOpen(false)}
                />
            </RailPopup>
        ) : null;

    const dockPanels: DockPanel[] = [
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
        {
            id: 'plan',
            placement: planPlacement.placement,
            open: planOpen,
            size: 352,
            content: (
                <PlanDock
                    plan={plan}
                    open={planOpen}
                    placementMenu={placementMenu(planPlacement)}
                    onClose={() => setPlanOpen(false)}
                />
            ),
        },
    ];

    return (
        <div className="relative flex min-h-0 min-w-0 flex-1">
            <DockLayout
                panels={dockPanels}
                trailingGrows={state.editorVisible}
                trailingFirst={treePlacement.placement === 'left'}
                trailing={
                    <CodeViewer
                        chatCollapsed={state.chatCollapsed}
                        treePlacement={treePlacement}
                        tabsStart={
                            state.chatCollapsed && sidebarCollapsed
                                ? sidebarToggle
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
                <ChatPanel
                    root={pane.root}
                    acceptsRemote={active}
                    projects={projects}
                    fill={!state.editorVisible}
                    headerStart={sidebarCollapsed ? sidebarToggle : null}
                    headerActions={
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('common.open_in_vs_code')}
                                title={t('common.open_in_vs_code')}
                                onClick={onOpenInVscode}
                                className="text-muted-foreground"
                            >
                                <Code2 aria-hidden="true" className="size-5" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Terminal"
                                aria-pressed={terminalOpen}
                                onClick={onToggleTerminal}
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
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(
                                    railOpen
                                        ? 'session_rail.hide'
                                        : 'session_rail.show',
                                )}
                                title={t(
                                    railOpen
                                        ? 'session_rail.hide'
                                        : 'session_rail.show',
                                )}
                                aria-expanded={railOpen}
                                aria-haspopup="dialog"
                                data-rail-toggle=""
                                onClick={toggleRail}
                                className={cn(
                                    'text-muted-foreground',
                                    railOpen &&
                                        'bg-accent text-accent-foreground',
                                )}
                            >
                                {/* * A box fills its whole square, so it is drawn smaller (16px against 20px) to look as big as the open icons beside it. */}
                                <SquareMenu
                                    aria-hidden="true"
                                    className="size-4"
                                />
                            </Button>
                            {panelsMenu}
                        </>
                    }
                    onTooNarrow={() =>
                        onPatch(pane.key, { chatCollapsed: true })
                    }
                    attachFile={state.attachFile}
                    selectedFile={state.activeFile}
                    viewSubagent={state.viewSubagent}
                    onLeaveSubagent={() =>
                        onPatch(pane.key, { viewSubagent: null })
                    }
                    popup={railPopup}
                    collapsed={
                        state.chatCollapsed &&
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
                    onSubagents={(subagents) =>
                        onPatch(pane.key, { subagents })
                    }
                    onPlan={changePlan}
                />
            </DockLayout>
        </div>
    );
}
