import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { MessageList } from '@/components/shell/chat/message-list';
import { useAgentTurns } from '@/components/shell/chat/use-agent-turns';
import { useAttachments } from '@/components/shell/chat/use-attachments';
import { useChatSession } from '@/components/shell/chat/use-chat-session';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';
import { useTooNarrow } from '@/components/shell/chat/use-too-narrow';
import type { ContextUsage } from '@/components/shell/context-panel';
import type { PlanData } from '@/components/shell/plan-pane';
import { Composer } from '@/components/shell/composer';
import { cn } from '@/lib/utils';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { pickFiles } from '@/lib/ide';
import type { AgentCli, Subagent } from '@/lib/ide';
import { t } from '@/lib/i18n';

// * The chat can be dragged this wide at most, so the file beside it keeps the larger share.
const CHAT_MAX_WIDTH = 560;

const NO_PROJECTS: { root: string; name: string }[] = [];

// * The chat has no project row above the box.
const clearNoProject = () => undefined;

/** Chat with an AI CLI in the open project: each message is one CLI turn, and the CLI's session id keeps the conversation going. Turns and session ids are saved per workspace, so reopening it continues the same CLI conversation. */
export function ChatPanel({
    root,
    fill,
    newChat,
    openConversation,
    onConversation,
    onChanged,
    onSubagents,
    onPlan,
    onContext,
    collapsed,
    popup,
    railOpen,
    onToggleRail,
    onTooNarrow,
    viewSubagent,
    onLeaveSubagent,
    attachFile,
    headerStart,
    headerActions,
    projects = NO_PROJECTS,
    acceptsRemote = false,
}: {
    /** The open pane takes the messages the phone app sends; the others ignore them. */
    acceptsRemote?: boolean;
    /** Saved projects (folder + name): the ones other than this chat's can be added to a turn. */
    projects?: { root: string; name: string }[];
    /** Folder of the project this chat belongs to: every command of the panel is addressed to it, so it keeps working while another project is open. */
    root: string;
    fill: boolean;
    /** Counter bumped to start a new conversation (ignored while a turn is running). */
    newChat: number;
    /** Conversation picked in the sidebar (ignored while a turn is running). */
    openConversation: { id: number; n: number } | null;
    /** Told which conversation is open, when it is loaded or started. */
    onConversation: (id: number) => void;
    /** Told when a turn was saved, so the list can be read again. */
    onChanged: () => void;
    /** Told which sub-agents the AI has started in the running turn (empty when none). */
    onSubagents: (subagents: Subagent[]) => void;
    /** Told the plan the AI wrote in the open conversation, when it is loaded or a turn writes a new one (null: none). */
    onPlan: (plan: PlanData | null) => void;
    /** Told the context usage of the open conversation whenever it changes (null: none reported yet), for the session rail. */
    onContext?: (usage: ContextUsage | null) => void;
    /** Closed by dragging the editor columns over it: hidden, but still mounted so a running turn goes on. */
    collapsed: boolean;
    /** Laid above the top of the message box (the session rail popup). */
    popup?: ReactNode;
    /** The session rail popup is open, and the toggle shown in the row under the message box. */
    railOpen?: boolean;
    onToggleRail?: () => void;
    /** Told when the editor columns have squeezed the chat narrower than it can be used; the app then closes it. */
    onTooNarrow: () => void;
    /** The sub-agent picked in the sidebar: the chat shows what it is doing instead of the conversation. */
    viewSubagent: string | null;
    /** A file double-clicked in the tree: it joins the attachments of the message. */
    attachFile: { path: string; n: number } | null;
    /** Back from the view of a sub-agent to the conversation. */
    onLeaveSubagent: () => void;
    /** Button at the left end of the bar at the top of the chat (folds the sidebar). */
    headerStart?: ReactNode;
    /** Buttons for the right end of that bar (branch, editor, terminal). */
    headerActions?: ReactNode;
}) {
    const [text, setText] = useState('');
    const [cli, setCli] = useState<AgentCli>('claude');
    // * The model is picked per CLI; none means the CLI's own default.
    const [models, setModels] = useState<Partial<Record<AgentCli, string>>>({});
    // * Claude only: the permission mode, and whether its experimental agent teams are on.
    const [mode, setMode] = useState('auto');
    const [agentTeam, setAgentTeam] = useState(false);
    // * Other projects the AI may also work in; kept for the whole chat, changed between messages.
    const [extraRoots, setExtraRoots] = useState<string[]>([]);
    // * Worktree mode: the turns of this conversation run on their own git branch, in a copy of the project.
    const [worktree, setWorktree] = useState(false);
    const bottom = useRef<HTMLDivElement>(null);
    const section = useRef<HTMLElement>(null);
    const width = useResizableWidth(
        'rynox.chat-width',
        384,
        200,
        CHAT_MAX_WIDTH,
        'x',
        'trailing',
    );
    const attachmentState = useAttachments(root, attachFile);
    const { attachments, attachError } = attachmentState;
    const session = useChatSession({
        root,
        newChat,
        openConversation,
        onConversation,
        onChanged,
        onSubagents,
        onPlan,
        onRestoreCli: setCli,
        onReset: attachmentState.reset,
    });
    const { turns, busy, context } = session;
    const reportContext = useStableCallback((usage: ContextUsage | null) =>
        onContext?.(usage),
    );

    useEffect(() => reportContext(context), [context, reportContext]);

    useTooNarrow(section, !fill && !collapsed, onTooNarrow);

    const {
        choose,
        sendFromComposer,
        switchAccount,
        answerPermission,
        stopTurns,
    } = useAgentTurns({
        root,
        projects,
        cli,
        onCli: setCli,
        models,
        mode,
        agentTeam,
        extraRoots,
        worktree,
        acceptsRemote,
        session,
        onComposerSent: () => {
            setText('');
            attachmentState.clearAfterSend();
        },
    });

    // * The list follows the answer only while the person is at (or near) the bottom: scrolling up to read stays where it is instead of being pulled down on every new word. Sending a message goes back to the bottom.
    const followEnd = useRef(true);
    const turnCount = useRef(0);

    useEffect(() => {
        const list = bottom.current?.closest<HTMLElement>('[data-chat-scroll]');

        if (!list) {
            return;
        }

        const onScroll = () => {
            followEnd.current =
                list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        };

        list.addEventListener('scroll', onScroll, { passive: true });

        return () => list.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const list = bottom.current?.closest<HTMLElement>('[data-chat-scroll]');
        const added = turns.length > turnCount.current;

        turnCount.current = turns.length;

        if (!list || (!followEnd.current && !added)) {
            return;
        }

        followEnd.current = true;

        // * One scroll per frame, however many words arrived; a new message glides down, the words of an answer follow without delay.
        const frame = requestAnimationFrame(() =>
            list.scrollTo({
                top: list.scrollHeight,
                behavior: added ? 'smooth' : 'auto',
            }),
        );

        return () => cancelAnimationFrame(frame);
    }, [turns]);

    // * A picked file goes into the message as `@path`: both CLIs read the file from that path.
    const addFiles = useCallback(
        () =>
            void pickFiles().then((paths) => {
                if (paths.length === 0) {
                    return;
                }

                setText(
                    (current) =>
                        `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${paths.map((path) => `@${path}`).join('\n')} `,
                );
            }),
        [],
    );

    // * Stable, so the message box (memoised) does not re-render on every streamed piece of an answer.
    const send = useStableCallback(() => {
        sendFromComposer(
            [
                text.trim(),
                ...attachments.map((attachment) => `@${attachment.path}`),
            ]
                .filter((part) => part !== '')
                .join('\n'),
        );
    });
    const chooseModel = useCallback(
        (chosen: AgentCli, model: string | null) => {
            setCli(chosen);
            setModels((all) => ({
                ...all,
                [chosen]: model ?? undefined,
            }));
        },
        [],
    );
    const projectName =
        projects.find((project) => project.root === root)?.name ??
        root.split('/').pop() ??
        root;
    const otherProjects = useMemo(
        () => projects.filter((project) => project.root !== root),
        [projects, root],
    );

    return (
        <section
            ref={section}
            aria-label={t('chat_panel.chat_with_ai')}
            style={fill ? undefined : { width: width.width }}
            className={cn(
                'relative flex min-h-0 flex-col',
                collapsed && 'hidden',
                // * The chat gives way: when the editor or the file column is dragged out to the full width it shrinks away (and clips) instead of pushing the sidebar off the screen.
                fill
                    ? 'max-w-full min-w-0 flex-1'
                    : 'max-w-full min-w-0 border-r',
            )}
        >
            {!fill && (
                <ResizeHandle
                    label={t('chat_panel.resize_chat_panel')}
                    className="right-0 left-auto translate-x-1/2"
                    {...width.handleProps}
                />
            )}
            <header className="flex h-[49px] shrink-0 items-center justify-between gap-2 border-b px-2">
                <span className="ml-2 flex items-center">{headerStart}</span>
                <span className="flex items-center gap-0.5">
                    {headerActions}
                </span>
            </header>
            <MessageList
                ref={bottom}
                turns={turns}
                viewSubagent={viewSubagent}
                onLeaveSubagent={onLeaveSubagent}
                onChoose={choose}
                onSwitchAccount={switchAccount}
                onPermission={answerPermission}
                projectName={projectName}
            />
            <Composer
                project={null}
                onClearProject={clearNoProject}
                value={text}
                onChange={setText}
                onSubmit={send}
                busy={busy}
                onStop={stopTurns}
                cli={cli}
                model={models[cli] ?? null}
                mode={mode}
                onModeChange={setMode}
                agentTeam={agentTeam}
                onAgentTeamChange={setAgentTeam}
                onChoose={chooseModel}
                onAddFiles={addFiles}
                attachments={attachments}
                attachError={attachError}
                onPasteFiles={attachmentState.pasteFiles}
                onPastePaths={attachmentState.pastePaths}
                onRemoveAttachment={attachmentState.removeAttachment}
                projectName={projectName}
                otherProjects={otherProjects}
                extraRoots={extraRoots}
                worktree={worktree}
                onWorktreeChange={setWorktree}
                onExtraRootsChange={setExtraRoots}
                railOpen={railOpen}
                onToggleRail={onToggleRail}
                popup={popup}
            />
        </section>
    );
}
