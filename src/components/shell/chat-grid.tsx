import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
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

/** The chat grid: up to four chats, from any projects, in one layout, with the files of the picked chat's project on the right. The chats of one project share one bar (project, Worktree, permission mode, agent team) and are stacked under it; projects sit side by side, so the bar is split the same way as the chats. */
export function ChatGrid({
    members,
    projects,
    headerStart,
    focus,
    onChanged,
}: {
    members: GridMember[];
    /** A project the sidebar asked to pick (a new object per request): its first chat becomes the picked one. */
    focus?: { root: string; n: number } | null;
    /** Saved projects (folder + name). */
    projects: { root: string; name: string }[];
    /** The button that unfolds the sidebar, shown while it is folded away. */
    headerStart?: ReactNode;
    /** Told when a turn of a chat was saved, with the project folder, so its conversation list is read again. */
    onChanged: (root: string) => void;
}) {
    // * Settings are per project: a project that is not a git repo (no Worktree), or one that needs another permission mode, does not hold the others back.
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
    const treePlacement = usePanelPlacement('file-tree', 'right');
    // * The file tree closed with its X: the button that opens it again sits in the header, at the side of the tree.
    const [treeClosed, setTreeClosed] = useState(false);
    // * Whether a file (or the list of changes) is open next to the tree: then the width of the chats is the person's to drag.
    const [editorVisible, setEditorVisible] = useState(false);
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
    // * One project: its chats sit side by side. Several: one column (or cell) per project, its chats stacked.
    const single = groups.length === 1;
    // * Chats side by side in the widest row, and the room the files may take while each keeps its minimum width.
    const chatColumns = single && members.length === 1 ? 1 : 2;
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
                        className={cn(
                            'grid min-h-0 min-w-0 flex-1 auto-rows-fr gap-px overflow-hidden bg-border',
                            single ? 'grid-cols-1' : 'grid-cols-2',
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
                                    {groupIndex === 0 && headerStart}
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
                                        worktree={
                                            settingsOf(group.root).worktree
                                        }
                                        onWorktreeChange={(worktree) =>
                                            patchSettings(group.root, {
                                                worktree,
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
                                    />
                                    {treeClosed &&
                                        !editorVisible &&
                                        treePlacement.placement !== 'left' &&
                                        groupIndex === groups.length - 1 &&
                                        openTreeButton(PanelRightOpen)}
                                </div>
                                <div
                                    className={cn(
                                        'grid min-h-0 min-w-0 flex-1 auto-rows-fr gap-px overflow-hidden bg-border',
                                        single && group.chats.length > 1
                                            ? 'grid-cols-2'
                                            : 'grid-cols-1',
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
                                                onChanged={() =>
                                                    onChanged(member.workspace)
                                                }
                                                onSubagents={ignore}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {picked !== undefined && (
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
                            treePlacement={treePlacement}
                            treeClosed={treeClosed}
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
