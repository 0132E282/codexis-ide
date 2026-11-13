import {
    LayoutGrid,
    ListChecks,
    PanelLeftOpen,
    PanelRightOpen,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CodeViewer } from '@/components/code-viewer';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { ChatHeaderActions } from '@/components/shell/chat-header-actions';
import { ContextPanel } from '@/components/shell/context-panel';
import type { ContextUsage } from '@/components/shell/context-panel';
import { PanelsMenu } from '@/components/shell/panels-menu';
import { RailPopup } from '@/components/shell/rail-popup';
import { SessionRail } from '@/components/shell/session-rail';
import { ProjectRow } from '@/components/shell/chat/project-row';
import { ChatPanel } from '@/components/shell/chat-panel';
import { Button } from '@/components/ui/button';
import { usePanelPlacement } from '@/hooks/use-panel-placement';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { api } from '@/lib/api';
import type { GridMember } from '@/lib/ide';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// * The grid's chats report nothing to a pane: each one only talks to its own conversation.
const ignore = () => undefined;
// * The narrowest a chat may get: the files give way before the chats are squeezed below it.
const CHAT_CELL_MIN_WIDTH = 288;
const FILES_MIN_WIDTH = 320;
// * Up to six cells share one screen: 1, 2 and 3 cells are one row; 4 is 2 × 2; 5 and 6 are 3 × 2. Beyond six, rows of three are added, keep a readable height and the area scrolls.
const GRID_ONE_SCREEN_CELLS = 6;
const columnsOf = (count: number) => (count === 4 ? 2 : Math.min(count, 3));
// * The rows split the height equally while everything fits on one screen; past that each keeps a minimum.
const rowsClass = (count: number) =>
    count > GRID_ONE_SCREEN_CELLS
        ? 'auto-rows-[minmax(22rem,1fr)] overflow-y-auto'
        : 'auto-rows-fr overflow-y-hidden';

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

/** Name of the project of a chat: the saved project with that folder, else the folder's own name. */
const nameOf = (projects: { root: string; name: string }[], root: string) =>
    projects.find((project) => project.root === root)?.name ??
    root.split('/').filter(Boolean).pop() ??
    root;

type ChatSettings = {
    mode: string;
    agentTeam: boolean;
    extraRoots: string[];
    worktree: boolean;
};
const DEFAULT_SETTINGS: ChatSettings = {
    mode: 'auto',
    agentTeam: false,
    extraRoots: [],
    worktree: false,
};

/** The chat grid: up to four chats, from any projects, in one layout, with the files of the picked chat's project on the right. The chats of one project share one bar (project, permission mode, agent team) and are stacked under it; projects sit side by side, so the bar is split the same way as the chats. */
export function ChatGrid({
    members,
    projects,
    headerStart,
    focus,
    codeDetachedRoots = [],
    onOpenInVscode,
    onFocusCodeWindow,
    terminalOpen = false,
    backgroundOpen = false,
    plansOpen = false,
    onToggleTerminal,
    onToggleBackground,
    onTogglePlans,
    onOpenSettings,
    onShowHistory,
    onChanged,
}: {
    members: GridMember[];
    /** A project the sidebar asked to pick (a new object per request): its first chat becomes the picked one. */
    focus?: { root: string; n: number } | null;
    /** Saved projects (folder + name). */
    projects: { root: string; name: string }[];
    /** Project folders whose code side is in a window of its own: the files of those are not drawn here. */
    codeDetachedRoots?: string[];
    /** Opens the folder of the picked chat in VS Code. */
    onOpenInVscode?: (root: string) => void;
    /** Brings forward the window that holds the code of that folder. */
    onFocusCodeWindow?: (root: string) => void;
    /** The bottom panel tabs open now, and what toggles them (the panel is drawn by the app under the grid). */
    terminalOpen?: boolean;
    backgroundOpen?: boolean;
    plansOpen?: boolean;
    onToggleTerminal?: () => void;
    onToggleBackground?: () => void;
    onTogglePlans?: () => void;
    onOpenSettings?: () => void;
    /** Opens the git history tab of the bottom panel. */
    onShowHistory?: () => void;
    /** The button that unfolds the sidebar, shown while it is folded away. */
    headerStart?: ReactNode;
    /** Told when a turn of a chat was saved, with the project folder, so its conversation list is read again. */
    onChanged: (root: string) => void;
}) {
    // * Settings are per project: a project that needs another permission mode does not hold the others back.
    const [settings, setSettings] = useState<Record<string, ChatSettings>>({});
    const settingsOf = (root: string) => settings[root] ?? DEFAULT_SETTINGS;
    const patchSettings = (root: string, change: Partial<ChatSettings>) =>
        setSettings((current) => ({
            ...current,
            [root]: { ...(current[root] ?? DEFAULT_SETTINGS), ...change },
        }));
    // * The chat the user last clicked: the file tree shows its project, and a file double-clicked there is attached to it.
    const [pickedId, setPickedId] = useState<number | null>(null);
    const [seenFocus, setSeenFocus] = useState(focus);

    if (focus !== seenFocus) {
        setSeenFocus(focus);
        const target = members.find(
            (member) => member.workspace === focus?.root,
        );

        if (target !== undefined) {
            setPickedId(target.conversation);
        }
    }
    const [attach, setAttach] = useState<{ path: string; n: number } | null>(
        null,
    );
    // * The context usage each chat reports (for the ring in the header), the session rail popup of the picked chat, and the file the rail asked the viewer to open.
    const [contexts, setContexts] = useState<
        Record<number, ContextUsage | null>
    >({});
    const [railOpen, setRailOpen] = useState(false);
    const [railRefresh, setRailRefresh] = useState(0);
    const [openRequest, setOpenRequest] = useState<{
        repo: string;
        path: string;
        id: number;
    } | null>(null);
    const toggleRail = () => setRailOpen((open) => !open);
    const treePlacement = usePanelPlacement('file-tree', 'right');
    // * The file tree closed with its X: the button that opens it again sits in the header, at the side of the tree.
    const [treeClosed, setTreeClosed] = useState(false);
    // * Whether a file (or the list of changes) is open next to the tree: then the width of the chats is the person's to drag.
    const [editorOpen, setEditorVisible] = useState(false);
    const filesOnLeft = treePlacement.placement === 'left';
    // * The width the floating files really get: the overlay is clamped to the grid, so the handle must report that, not the stored width.
    const gridArea = useRef<HTMLDivElement>(null);
    const [areaWidth, setAreaWidth] = useState(Infinity);

    useEffect(() => {
        const element = gridArea.current;

        if (element === null) {
            return;
        }

        const observer = new ResizeObserver(() =>
            setAreaWidth(element.clientWidth),
        );

        observer.observe(element);

        return () => observer.disconnect();
    }, []);
    const filesWidth = useResizableWidth(
        'ide.width.grid-files',
        720,
        320,
        window.innerWidth,
        'x',
        // * The bar is on the edge of the files that faces the chats: the left edge when the files are on the right, the right edge when they are on the left.
        filesOnLeft ? 'trailing' : 'leading',
    );
    const key = members
        .map((member) => `${member.workspace}:${member.conversation}`)
        .join(',');
    // * The chats grouped by project, in the order the projects first appear.
    const groups = useMemo(() => {
        const byRoot = new Map<string, GridMember[]>();

        for (const member of members) {
            byRoot.set(member.workspace, [
                ...(byRoot.get(member.workspace) ?? []),
                member,
            ]);
        }

        return [...byRoot.entries()].map(([root, chats]) => ({ root, chats }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    // * Same objects between renders: a new one would make a chat load its conversation again.
    const opened = useMemo(
        () =>
            new Map(
                members.map((member) => [
                    member.conversation,
                    { id: member.conversation, n: 1 },
                ]),
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [key],
    );
    const picked =
        members.find((member) => member.conversation === pickedId) ??
        members[0];
    // * The picked project's code is in a window of its own: no files here, so the chats keep the room.
    const codeDetached =
        picked !== undefined && codeDetachedRoots.includes(picked.workspace);
    const editorVisible = editorOpen && !codeDetached;
    // * The tree is the leftmost column when it is on the left and open (and drawn here): the sidebar toggle goes at the start of its toolbar, not in the chat header. With the code in a window of its own there is no tree, so the header keeps the toggle (and the room for the window buttons).
    const toggleInTree =
        filesOnLeft &&
        !treeClosed &&
        !codeDetached &&
        headerStart !== undefined;
    // * One project: its chats sit in rows of up to three. Several: the projects sit in rows of up to three, each with its chats stacked.
    const single = groups.length === 1;
    // * Cells side by side in the widest row, and the room the files may take while each keeps its minimum width.
    const chatColumns = columnsOf(single ? members.length : groups.length);
    const filesRoom = Math.max(
        FILES_MIN_WIDTH,
        areaWidth - chatColumns * CHAT_CELL_MIN_WIDTH,
    );
    const shownFilesWidth = Math.min(filesWidth.width, filesRoom);

    const openTreeButton = (Icon: typeof PanelRightOpen, inBar = true) => (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('tree_panel.open')}
            title={t('tree_panel.open')}
            onClick={() => setTreeClosed(false)}
            className={cn(
                'shrink-0 text-muted-foreground',
                inBar && Icon === PanelRightOpen && 'ml-auto',
            )}
        >
            <Icon aria-hidden="true" />
        </Button>
    );

    return (
        <div
            data-testid="chat-grid"
            className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
            <div
                ref={gridArea}
                className="relative flex min-h-0 min-w-0 flex-1"
            >
                {/* * A file open takes its side of the area and the chats share the rest, so the viewer never covers a chat. */}
                <div
                    style={
                        editorVisible
                            ? filesOnLeft
                                ? { paddingLeft: shownFilesWidth }
                                : { paddingRight: shownFilesWidth }
                            : undefined
                    }
                    className="relative flex min-h-0 min-w-0 max-w-full flex-1"
                >
                    <div
                        style={{
                            gridTemplateColumns: `repeat(${single ? 1 : columnsOf(groups.length)}, minmax(0, 1fr))`,
                        }}
                        className={cn(
                            'grid min-h-0 min-w-0 flex-1 gap-px overflow-x-hidden bg-border',
                            rowsClass(single ? 1 : groups.length),
                        )}
                    >
                        {groups.map((group, groupIndex) => (
                            <div
                                key={group.root}
                                data-testid="chat-grid-project"
                                className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
                            >
                                <div className="flex h-12 shrink-0 items-center border-b px-2">
                                    {/* * The button that unfolds the sidebar sits in the first bar, so the grid has no row of its own above it. */}
                                    {groupIndex === 0 &&
                                        !toggleInTree &&
                                        headerStart}
                                    {treeClosed &&
                                        !editorVisible &&
                                        treePlacement.placement === 'left' &&
                                        groupIndex === 0 &&
                                        openTreeButton(PanelLeftOpen)}
                                    <ProjectRow
                                        busy={false}
                                        projectName={nameOf(
                                            projects,
                                            group.root,
                                        )}
                                        otherProjects={projects.filter(
                                            (project) =>
                                                project.root !== group.root,
                                        )}
                                        extraRoots={
                                            settingsOf(group.root).extraRoots
                                        }
                                        onExtraRootsChange={(extraRoots) =>
                                            patchSettings(group.root, {
                                                extraRoots,
                                            })
                                        }
                                        cli="claude"
                                        compact
                                        mode={settingsOf(group.root).mode}
                                        onModeChange={(mode) =>
                                            patchSettings(group.root, { mode })
                                        }
                                        agentTeam={
                                            settingsOf(group.root).agentTeam
                                        }
                                        onAgentTeamChange={(agentTeam) =>
                                            patchSettings(group.root, {
                                                agentTeam,
                                            })
                                        }
                                        worktree={
                                            settingsOf(group.root).worktree
                                        }
                                        onWorktreeChange={(worktree) =>
                                            patchSettings(group.root, {
                                                worktree,
                                            })
                                        }
                                    />
                                    {treeClosed &&
                                        !editorVisible &&
                                        treePlacement.placement !== 'left' &&
                                        groupIndex === groups.length - 1 &&
                                        openTreeButton(PanelRightOpen)}
                                    {/* * The same buttons as the header of a single chat, for the picked chat's project. */}
                                    {groupIndex === groups.length - 1 &&
                                        picked !== undefined && (
                                            <span className="ml-auto flex items-center gap-0.5">
                                                <ContextPanel
                                                    usage={
                                                        contexts[
                                                            picked.conversation
                                                        ] ?? null
                                                    }
                                                    onClick={toggleRail}
                                                />
                                                <ChatHeaderActions
                                                    onOpenInVscode={() =>
                                                        onOpenInVscode?.(
                                                            picked.workspace,
                                                        )
                                                    }
                                                    terminalOpen={terminalOpen}
                                                    onToggleTerminal={() =>
                                                        codeDetached
                                                            ? onFocusCodeWindow?.(
                                                                  picked.workspace,
                                                              )
                                                            : onToggleTerminal?.()
                                                    }
                                                    railOpen={railOpen}
                                                    onToggleRail={toggleRail}
                                                    filesLabel={t(
                                                        treeClosed &&
                                                            !codeDetached
                                                            ? 'workspace_pane.show_files'
                                                            : 'workspace_pane.hide_files',
                                                    )}
                                                    filesShown={
                                                        !codeDetached &&
                                                        !treeClosed
                                                    }
                                                    onToggleFiles={() =>
                                                        codeDetached
                                                            ? onFocusCodeWindow?.(
                                                                  picked.workspace,
                                                              )
                                                            : setTreeClosed(
                                                                  (closed) =>
                                                                      !closed,
                                                              )
                                                    }
                                                    menu={
                                                        <PanelsMenu
                                                            items={[
                                                                {
                                                                    id: 'background',
                                                                    icon: ListChecks,
                                                                    label: t(
                                                                        'background_tasks.title',
                                                                    ),
                                                                    open: backgroundOpen,
                                                                    onToggle:
                                                                        () =>
                                                                            onToggleBackground?.(),
                                                                },
                                                                {
                                                                    id: 'plans',
                                                                    icon: LayoutGrid,
                                                                    label: t(
                                                                        'plans.title',
                                                                    ),
                                                                    open: plansOpen,
                                                                    onToggle:
                                                                        () =>
                                                                            onTogglePlans?.(),
                                                                },
                                                            ]}
                                                        />
                                                    }
                                                />
                                            </span>
                                        )}
                                </div>
                                <div
                                    style={{
                                        gridTemplateColumns: `repeat(${single ? columnsOf(group.chats.length) : 1}, minmax(0, 1fr))`,
                                    }}
                                    className={cn(
                                        'grid min-h-0 min-w-0 flex-1 gap-px overflow-x-hidden bg-border',
                                        // * Alone in the area the chats are laid out in rows; stacked in a project's cell they share its height.
                                        single
                                            ? rowsClass(group.chats.length)
                                            : 'auto-rows-fr overflow-y-hidden',
                                    )}
                                >
                                    {group.chats.map((member) => (
                                        <div
                                            key={member.conversation}
                                            onPointerDownCapture={() =>
                                                setPickedId(member.conversation)
                                            }
                                            className="flex min-h-0 min-w-0 overflow-hidden bg-background"
                                        >
                                            <ChatPanel
                                                root={member.workspace}
                                                projects={projects}
                                                fill
                                                showHeader={false}
                                                sharedOptions={settingsOf(
                                                    member.workspace,
                                                )}
                                                onTooNarrow={ignore}
                                                attachFile={
                                                    member.conversation ===
                                                    picked?.conversation
                                                        ? attach
                                                        : null
                                                }
                                                viewSubagent={null}
                                                onLeaveSubagent={ignore}
                                                collapsed={false}
                                                newChat={0}
                                                openConversation={
                                                    opened.get(
                                                        member.conversation,
                                                    ) ?? null
                                                }
                                                onConversation={ignore}
                                                onChanged={() => {
                                                    onChanged(member.workspace);
                                                    setRailRefresh(
                                                        (count) => count + 1,
                                                    );
                                                }}
                                                onSubagents={ignore}
                                                onContext={(usage) =>
                                                    setContexts((current) => ({
                                                        ...current,
                                                        [member.conversation]:
                                                            usage,
                                                    }))
                                                }
                                                onOpenRail={toggleRail}
                                                popup={
                                                    railOpen &&
                                                    member.conversation ===
                                                        picked?.conversation ? (
                                                        <RailPopup
                                                            onClose={() =>
                                                                setRailOpen(
                                                                    false,
                                                                )
                                                            }
                                                        >
                                                            <SessionRail
                                                                root={
                                                                    member.workspace
                                                                }
                                                                projectName={nameOf(
                                                                    projects,
                                                                    member.workspace,
                                                                )}
                                                                conversation={
                                                                    member.conversation
                                                                }
                                                                context={
                                                                    contexts[
                                                                        member
                                                                            .conversation
                                                                    ] ?? null
                                                                }
                                                                refreshKey={
                                                                    railRefresh
                                                                }
                                                                placementMenu={
                                                                    null
                                                                }
                                                                onOpenSettings={() =>
                                                                    onOpenSettings?.()
                                                                }
                                                                onOpenFile={(
                                                                    path,
                                                                ) =>
                                                                    setOpenRequest(
                                                                        (
                                                                            current,
                                                                        ) => ({
                                                                            repo: `local:${member.workspace}`,
                                                                            path,
                                                                            id:
                                                                                (current?.id ??
                                                                                    0) +
                                                                                1,
                                                                        }),
                                                                    )
                                                                }
                                                                onShowHistory={() =>
                                                                    onShowHistory?.()
                                                                }
                                                                onClearContext={() =>
                                                                    setRailOpen(
                                                                        false,
                                                                    )
                                                                }
                                                                onClose={() =>
                                                                    setRailOpen(
                                                                        false,
                                                                    )
                                                                }
                                                            />
                                                        </RailPopup>
                                                    ) : null
                                                }
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {picked !== undefined && !codeDetached && (
                    // * The files sit on the side the person put the file tree on (left or right), as in a single chat. With a file open, the file and the tree take that side from the very top, so the header of the files is the one header of that side, at a width the person drags.
                    <div
                        role={editorVisible ? 'complementary' : undefined}
                        aria-label={
                            editorVisible ? t('common.files') : undefined
                        }
                        style={
                            editorVisible
                                ? { width: shownFilesWidth }
                                : undefined
                        }
                        className={cn(
                            'flex min-h-0 min-w-0',
                            editorVisible
                                ? cn(
                                      'absolute inset-y-0 z-20 max-w-full bg-background shadow-lg',
                                      filesOnLeft
                                          ? 'left-0 border-r'
                                          : 'right-0 border-l',
                                  )
                                : filesOnLeft && 'order-first border-r',
                        )}
                    >
                        {editorVisible && (
                            <ResizeHandle
                                label={t('chat_grid.resize_chats')}
                                className={
                                    filesOnLeft
                                        ? 'right-0 left-auto translate-x-1/2'
                                        : undefined
                                }
                                {...filesWidth.handleProps}
                                aria-valuenow={Math.round(shownFilesWidth)}
                            />
                        )}
                        {/* * The file tree is closed and the files cover the bar that holds its button: the button sits here, on the tree's side of the files. */}
                        {editorVisible && treeClosed && (
                            <div
                                className={cn(
                                    'flex w-10 shrink-0 justify-center pt-2',
                                    filesOnLeft
                                        ? 'order-first border-r'
                                        : 'order-last border-l',
                                )}
                            >
                                {openTreeButton(
                                    filesOnLeft
                                        ? PanelLeftOpen
                                        : PanelRightOpen,
                                    false,
                                )}
                            </div>
                        )}
                        <CodeViewer
                            key={picked.workspace}
                            openRequest={openRequest}
                            treePlacement={treePlacement}
                            treeClosed={treeClosed}
                            toolbarStart={
                                toggleInTree ? headerStart : undefined
                            }
                            onEditorVisible={setEditorVisible}
                            onTreeClosedChange={setTreeClosed}
                            onAttachFile={(path) =>
                                setAttach((current) => ({
                                    path,
                                    n: (current?.n ?? 0) + 1,
                                }))
                            }
                            repo={`local:${picked.workspace}`}
                            repos={[`local:${picked.workspace}`]}
                            onViewRepo={ignore}
                            changes={[]}
                            assistant={{ name: 'Codexis' }}
                            onInlineAsk={askAssistant(picked.workspace)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
