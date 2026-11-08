import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import { ChoiceCard } from '@/components/ai-chat/choice-card';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { ProjectRow } from '@/components/shell/chat/project-row';
import { MessageList } from '@/components/shell/chat/message-list';
import { useAgentTurns } from '@/components/shell/chat/use-agent-turns';
import { formatLines } from '@/components/shell/chat/attachment';
import { useAttachments } from '@/components/shell/chat/use-attachments';
import { useChatSession } from '@/components/shell/chat/use-chat-session';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';
import { useFreshAnswer } from '@/components/shell/chat/use-fresh-answer';
import { useTooNarrow } from '@/components/shell/chat/use-too-narrow';
import {
    ContextPanel,
    type ContextUsage,
} from '@/components/shell/context-panel';
import type { PlanData } from '@/components/shell/plan-pane';
import { Composer } from '@/components/shell/composer';
import { cn } from '@/lib/utils';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { markChatActive } from '@/hooks/use-voice-preferences';
import { findChoices } from '@/lib/choices-parser';
import { pickFiles } from '@/lib/ide';
import type { AgentCli, Subagent } from '@/lib/ide';
import { t } from '@/lib/i18n';

// * The chat can be dragged this wide at most, so the file beside it keeps the larger share.
const CHAT_MAX_WIDTH = 560;

/** Settings shared by the chats of the grid: set once in the row under the grid, they replace the ones each chat keeps for itself. */
export type SharedChatOptions = {
    mode: string;
    agentTeam: boolean;
    extraRoots: string[];
    worktree: boolean;
};

const NO_PROJECTS: { root: string; name: string }[] = [];

// * The chat has no project row above the box.
const clearNoProject = () => undefined;

/** Chat with an AI CLI in the open project: each message is one CLI turn, and the CLI's session id keeps the conversation going. Turns and session ids are saved per workspace, so reopening it continues the same CLI conversation. */
export function ChatPanel({
    root,
    fill,
    canCollapse = !fill,
    newChat,
    openConversation,
    onConversation,
    onChanged,
    onSubagents,
    onPlan,
    onContext,
    onRunningPrompts,
    collapsed,
    popup,
    onTooNarrow,
    viewSubagent,
    onLeaveSubagent,
    attachFile,
    sendRequest = null,
    selectedFile = null,
    headerStart,
    headerActions,
    showHeader = true,
    sharedOptions,
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
    /** The chat folds away once squeezed too narrow; by default only when it is not filling (its width is its own). */
    canCollapse?: boolean;
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
    /** Told the prompts of the turns that are running, whenever that list changes. */
    onRunningPrompts?: (prompts: string[]) => void;
    /** Closed by dragging the editor columns over it: hidden, but still mounted so a running turn goes on. */
    collapsed: boolean;
    /** Laid above the top of the message box (the session rail popup). */
    popup?: ReactNode;
    /** Told when the editor columns have squeezed the chat narrower than it can be used; the app then closes it. */
    onTooNarrow: () => void;
    /** The sub-agent picked in the sidebar: the chat shows what it is doing instead of the conversation. */
    viewSubagent: string | null;
    /** A file double-clicked in the tree: it joins the attachments of the message. */
    attachFile: { path: string; n: number } | null;
    /** A message a button outside the chat asked it to send (`n` changes on every request). */
    sendRequest?: { text: string; n: number } | null;
    /** The file selected in the file tree (path inside the project): it shows as a chip above the message box and goes with the message. */
    selectedFile?: string | null;
    /** Back from the view of a sub-agent to the conversation. */
    onLeaveSubagent: () => void;
    /** Button at the left end of the bar at the top of the chat (folds the sidebar). */
    headerStart?: ReactNode;
    /** Buttons for the right end of that bar (branch, editor, terminal). */
    headerActions?: ReactNode;
    /** False in the chat grid, where one bar above all the chats stands in for the bar of each. */
    showHeader?: boolean;
    /** Chat grid: the settings come from the one row under the grid, and the chat shows no row of its own. */
    sharedOptions?: SharedChatOptions;
}) {
    const [text, setText] = useState('');
    const [cli, setCli] = useState<AgentCli>('claude');
    // * The model is picked per CLI; none means the CLI's own default.
    const [models, setModels] = useState<Partial<Record<AgentCli, string>>>({});
    // * Claude only: the permission mode, and whether its experimental agent teams are on.
    const [ownMode, setMode] = useState('auto');
    const [ownAgentTeam, setAgentTeam] = useState(false);
    // * Other projects the AI may also work in; kept for the whole chat, changed between messages.
    const [ownExtraRoots, setExtraRoots] = useState<string[]>([]);
    // * Worktree mode: the turns of this conversation run on their own git branch, in a copy of the project.
    const [ownWorktree, setWorktree] = useState(false);
    const mode = sharedOptions?.mode ?? ownMode;
    const agentTeam = sharedOptions?.agentTeam ?? ownAgentTeam;
    const extraRoots = sharedOptions?.extraRoots ?? ownExtraRoots;
    const worktree = sharedOptions?.worktree ?? ownWorktree;
    // * Names this chat among the chats of the grid: only the one in use reads its answers aloud.
    const chatId = useId();
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
    // * The open conversation, so a pasted picture is kept in the database with it.
    const conversationId = useRef<number | undefined>(undefined);
    const getConversationId = useCallback(() => conversationId.current, []);
    const attachmentState = useAttachments(
        root,
        attachFile,
        selectedFile,
        getConversationId,
    );
    const { attachments, attachError } = attachmentState;
    const session = useChatSession({
        root,
        newChat,
        openConversation,
        onConversation: (id) => {
            conversationId.current = id ?? undefined;
            onConversation?.(id);
        },
        onChanged,
        onSubagents,
        onPlan,
        onRestoreCli: setCli,
        onReset: attachmentState.reset,
    });
    const { turns, busy, context } = session;
    // * Only a finished answer: the speaker button reads it, and the message box is not redrawn for every streamed piece.
    let lastAnswer = '';

    for (let index = turns.length - 1; index >= 0; index--) {
        if (!turns[index].running && turns[index].answer !== '') {
            lastAnswer = turns[index].answer;

            break;
        }
    }

    const freshAnswer = useFreshAnswer(turns, chatId);
    const reportContext = useStableCallback((usage: ContextUsage | null) =>
        onContext?.(usage),
    );

    useEffect(() => reportContext(context), [context, reportContext]);

    // * Joined text as the key: a streamed piece changes `turns` but not which prompts run, so nothing is reported then.
    const reportRunningPrompts = useStableCallback((prompts: string[]) =>
        onRunningPrompts?.(prompts),
    );
    const runningPromptsKey = JSON.stringify(
        turns.filter((turn) => turn.running).map((turn) => turn.prompt),
    );

    useEffect(
        () => reportRunningPrompts(JSON.parse(runningPromptsKey) as string[]),
        [runningPromptsKey, reportRunningPrompts],
    );

    useTooNarrow(section, canCollapse && !collapsed, onTooNarrow);

    const {
        waiting,
        clearWaiting,
        choose,
        sendFromComposer,
        sendPrompt,
        switchAccount,
        answerPermission,
        stopTurns,
    } = useAgentTurns({
        root,
        projects,
        cli,
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

    // * A message asked for from outside (the plans list) is sent once per request; one that was already there when the chat mounted is not.
    const seenSendRequest = useRef(sendRequest);

    useEffect(() => {
        if (sendRequest !== null && sendRequest !== seenSendRequest.current) {
            seenSendRequest.current = sendRequest;
            sendPrompt(sendRequest.text);
        }
    }, [sendRequest, sendPrompt]);

    // * Stable, so the message box (memoised) does not re-render on every streamed piece of an answer.
    const send = useStableCallback(() => {
        sendFromComposer(
            [
                text.trim(),
                ...attachments.map((attachment) =>
                    attachment.lines === undefined
                        ? `@${attachment.path}`
                        : `${attachment.path}:${formatLines(attachment.lines)}`,
                ),
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
    const waitingPrompts = useMemo(
        () => waiting.map((item) => item.prompt),
        [waiting],
    );

    // * The choices the last, finished turn waits for an answer to: a popup above the message box (closed by the card itself), not part of the thread.
    const lastTurn = turns[turns.length - 1];
    const pendingChoices = useMemo(
        () =>
            lastTurn === undefined || lastTurn.running
                ? null
                : findChoices(lastTurn.answer),
        [lastTurn],
    );
    const choicesPopup =
        pendingChoices !== null && viewSubagent === null ? (
            <div className="absolute inset-x-0 bottom-full z-30 mb-2">
                <ChoiceCard
                    key={lastTurn.id}
                    floating
                    choices={pendingChoices}
                    interactive
                    answer={null}
                    onChoose={choose}
                />
            </div>
        ) : null;

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
            onFocusCapture={() => markChatActive(chatId)}
            onPointerDownCapture={() => markChatActive(chatId)}
            aria-label={t('chat_panel.chat_with_ai')}
            style={fill ? undefined : { width: width.width }}
            className={cn(
                'relative flex min-h-0 flex-col',
                collapsed
                    ? 'hidden'
                    : // * Shown again: it fades in from the side (the section stays mounted, display none to flex restarts the animation).
                      'animate-in fade-in-0 slide-in-from-left-6 duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none',
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
            {showHeader && (
                <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2">
                    <span className="ml-2 flex items-center">
                        {headerStart}
                    </span>
                    {/* * The project and the settings sit in the header, not under the message box; in the chat grid one bar for all the chats stands in for it. */}
                    <div className="min-w-0 flex-1 overflow-hidden">
                        {sharedOptions === undefined && (
                            <ProjectRow
                                busy={busy}
                                projectName={projectName}
                                otherProjects={otherProjects}
                                extraRoots={extraRoots}
                                onExtraRootsChange={setExtraRoots}
                                worktree={worktree}
                                onWorktreeChange={setWorktree}
                                compact
                                cli={cli}
                                mode={mode}
                                onModeChange={setMode}
                                agentTeam={agentTeam}
                                onAgentTeamChange={setAgentTeam}
                            />
                        )}
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5">
                        <ContextPanel usage={context} cli={cli} />
                        {headerActions}
                    </span>
                </header>
            )}
            <MessageList
                ref={bottom}
                turns={turns}
                viewSubagent={viewSubagent}
                onLeaveSubagent={onLeaveSubagent}
                onChoose={choose}
                choicesInPopup
                onSwitchAccount={switchAccount}
                onPermission={answerPermission}
                projectName={projectName}
                waiting={waitingPrompts}
            />
            <Composer
                project={null}
                onClearProject={clearNoProject}
                value={text}
                onChange={setText}
                onSubmit={send}
                busy={busy}
                waiting={waitingPrompts}
                onClearWaiting={clearWaiting}
                onStop={stopTurns}
                cli={cli}
                model={models[cli] ?? null}
                onChoose={chooseModel}
                onAddFiles={addFiles}
                attachments={attachments}
                attachError={attachError}
                onPasteFiles={attachmentState.pasteFiles}
                onPastePaths={attachmentState.pastePaths}
                onPasteReference={attachmentState.pasteReference}
                onRemoveAttachment={attachmentState.removeAttachment}
                lastAnswer={lastAnswer}
                freshAnswer={freshAnswer}
                popup={popup ?? choicesPopup}
            />
        </section>
    );
}
