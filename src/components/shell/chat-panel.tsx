import { FileText } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import logo from '@/assets/logo.png';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { Composer } from '@/components/shell/composer';
import type { Attachment } from '@/components/shell/composer';
import { cn } from '@/lib/utils';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { useTypewriter } from '@/hooks/use-typewriter';
import { errorText, ide, onAgentEvent, pickFiles } from '@/lib/ide';
import { ideSettings } from '@/lib/ide-settings';
import { ideUsage } from '@/lib/ide-usage';
import type { AgentCli, ChatHistory } from '@/lib/ide';

type Turn = {
    id: string;
    prompt: string;
    answer: string;
    error: string | null;
    running: boolean;
    cli: AgentCli;
    /** Loaded from the saved history: shown at once, not typed out. */
    restored?: boolean;
};

const ATTACHMENT_LINE = /^@(\/.+)$/;
// * Pasted files are saved as `<8 hex digits>-<name>`: the digits are not part of the name the person sees.
const SAVED_PREFIX = /^[0-9a-f]{8}-/;

/** A message's `@/path` lines are attached files: they are shown as chips, the rest is the typed text. */
function splitPrompt(prompt: string) {
    const files: { path: string; name: string }[] = [];
    const lines: string[] = [];

    for (const line of prompt.split('\n')) {
        const path = ATTACHMENT_LINE.exec(line)?.[1].trim();

        if (path === undefined) {
            lines.push(line);
        } else {
            const base = path.split('/').pop() ?? path;

            files.push({ path, name: base.replace(SAVED_PREFIX, '') });
        }
    }

    return { text: lines.join('\n').trim(), files };
}

const IMAGE_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};

/** An attached file in the message: an image is shown as a picture, anything else (or an image that cannot be read) as a chip. */
function AttachmentView({ path, name }: { path: string; name: string }) {
    const type = IMAGE_TYPES[(path.split('.').pop() ?? '').toLowerCase()];
    const [source, setSource] = useState<string | null>(null);

    useEffect(() => {
        if (type === undefined) {
            return;
        }

        let url: string | null = null;
        let cancelled = false;

        ide.readAttachment(path)
            .then((bytes) => {
                if (!cancelled) {
                    url = URL.createObjectURL(new Blob([bytes], { type }));
                    setSource(url);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;

            if (url !== null) {
                URL.revokeObjectURL(url);
            }
        };
    }, [path, type]);

    if (source !== null) {
        return (
            <img
                src={source}
                alt={name}
                title={name}
                className="size-20 rounded-lg border object-cover"
            />
        );
    }

    // * An image that is still loading, or cannot be read, shows the app logo in the same square.
    if (type !== undefined) {
        return (
            <img
                src={logo}
                alt={name}
                title={name}
                className="size-20 rounded-lg border bg-card object-contain p-4 opacity-60"
            />
        );
    }

    return (
        <span
            title={path}
            className="flex max-w-60 items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
        >
            <FileText aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{name}</span>
        </span>
    );
}

// * Memoised: dragging the panel edge re-renders the panel on every frame, and a long markdown answer must not be parsed again each time.
const TurnView = memo(function TurnView({ turn }: { turn: Turn }) {
    const typed = useTypewriter(turn.answer, turn.restored !== true);
    const { text, files } = splitPrompt(turn.prompt);

    return (
        <div className="min-w-0 space-y-3">
            <div className="ml-auto flex w-fit max-w-[85%] min-w-0 flex-col items-end gap-2">
                {files.length > 0 && (
                    <ul className="flex flex-wrap justify-end gap-2">
                        {files.map((file) => (
                            <li key={file.path}>
                                <AttachmentView
                                    path={file.path}
                                    name={file.name}
                                />
                            </li>
                        ))}
                    </ul>
                )}
                {text !== '' && (
                    <p className="rounded-2xl bg-muted px-4 py-2.5 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {text}
                    </p>
                )}
            </div>
            {typed !== '' && (
                <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                    <MarkdownContent content={typed} />
                </div>
            )}
            {turn.running && turn.answer === '' && (
                <p className="text-muted-foreground">Đang trả lời…</p>
            )}
            {turn.error !== null && (
                <p role="alert" className="text-destructive">
                    {turn.error}
                </p>
            )}
        </div>
    );
});

/** Chat with an AI CLI in the open project: each message is one CLI turn, and the CLI's session id keeps the conversation going. Turns and session ids are saved per workspace, so reopening it continues the same CLI conversation. */
export function ChatPanel({
    fill,
    newChat,
    openConversation,
    onConversation,
    onChanged,
}: {
    fill: boolean;
    /** Counter bumped to start a new conversation (ignored while a turn is running). */
    newChat: number;
    /** Conversation picked in the sidebar (ignored while a turn is running). */
    openConversation: number | null;
    /** Told which conversation is open, when it is loaded or started. */
    onConversation: (id: number) => void;
    /** Told when a turn was saved, so the list can be read again. */
    onChanged: () => void;
}) {
    const [turns, setTurns] = useState<Turn[]>([]);
    const [text, setText] = useState('');
    const [cli, setCli] = useState<AgentCli>('claude');
    // * The model is picked per CLI; none means the CLI's own default.
    // * Claude only: the permission mode, and whether its experimental agent teams are on.
    const [mode, setMode] = useState('auto');
    const [agentTeam, setAgentTeam] = useState(false);
    const [models, setModels] = useState<Partial<Record<AgentCli, string>>>({});
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [attachError, setAttachError] = useState<string | null>(null);
    const attachmentCounter = useRef(0);
    // * One session per CLI: a Claude session id means nothing to Codex.
    const sessions = useRef<Partial<Record<AgentCli, string>>>({});
    const runs = useRef(new Map<string, AgentCli>());
    // * Turns being answered, updated at once (state is not): the finished turn is saved from here.
    const drafts = useRef(new Map<string, Turn>());
    // * Key of the saved history; null while it is not loaded (or could not be), and nothing is saved then.
    const workspace = useRef<string | null>(null);
    // * The conversation the turns are saved into; null until the history is loaded.
    const conversation = useRef<number | null>(null);
    const notify = useRef({ onConversation, onChanged });
    const counter = useRef(0);
    const bottom = useRef<HTMLDivElement>(null);
    const width = useResizableWidth(
        'rynox.chat-width',
        384,
        200,
        window.innerWidth,
        'x',
        'trailing',
    );
    const busy = turns.some((turn) => turn.running);
    // * Set after each render: the agent events are listened to once, and the move to the next AI needs the latest state.
    const failover = useRef<((finished: Turn) => void) | null>(null);
    // * The CLIs already tried for a message that is being moved from one AI to the next, by turn id.
    const chains = useRef(new Map<string, AgentCli[]>());
    const handledNewChat = useRef(newChat);

    useEffect(() => {
        notify.current = { onConversation, onChanged };
    });

    // * Shows a loaded conversation: `replace` swaps the turns, otherwise they go before what was typed while it loaded.
    const apply = (history: ChatHistory, replace: boolean) => {
        workspace.current = history.workspace;
        conversation.current = history.conversation;
        sessions.current = replace
            ? { ...history.sessions }
            : { ...history.sessions, ...sessions.current };

        const last = history.turns.at(-1);

        if (last !== undefined) {
            setCli(last.cli);
        }

        const restored = history.turns.map((turn) => ({
            ...turn,
            running: false,
            restored: true,
        }));

        setTurns((current) => (replace ? restored : [...restored, ...current]));
        notify.current.onConversation(history.conversation);
    };

    useEffect(() => {
        let cancelled = false;

        ide.chatLoad()
            .then((history) => !cancelled && apply(history, false))
            // * No saved history: the chat still works, it is just not kept.
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (
            openConversation === null ||
            openConversation === conversation.current ||
            busy
        ) {
            return;
        }

        void ide
            .chatLoad(openConversation)
            .then((history) => {
                apply(history, true);
                setAttachments([]);
                setAttachError(null);
            })
            .catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openConversation]);

    useEffect(() => {
        if (newChat === handledNewChat.current) {
            return;
        }

        handledNewChat.current = newChat;

        // * Not while a turn is being answered: it would be saved into the new conversation.
        if (busy || workspace.current === null) {
            return;
        }

        void ide
            .chatNew(workspace.current)
            .then((id) => {
                conversation.current = id;
                sessions.current = {};
                setTurns([]);
                setAttachments([]);
                setAttachError(null);
                notify.current.onConversation(id);
                notify.current.onChanged();
            })
            .catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newChat]);

    // * Only sizes and the error text go to the statistics; the model is not known to the chat.
    const recordUsage = (turn: Turn): Promise<boolean> =>
        ideUsage
            .record({
                cli: turn.cli,
                promptCharacters: turn.prompt.length,
                answerCharacters: turn.answer.length,
                model: null,
                error: turn.error,
            })
            .catch(() => false);

    const persist = (turn: Turn) => {
        if (workspace.current !== null && conversation.current !== null) {
            void ide
                .chatSaveTurn(workspace.current, conversation.current, {
                    id: turn.id,
                    cli: turn.cli,
                    prompt: turn.prompt,
                    answer: turn.answer,
                    error: turn.error,
                })
                .then(() => notify.current.onChanged())
                .catch(() => undefined);
        }
    };

    useEffect(() => {
        const update = (id: string, change: (turn: Turn) => Turn) => {
            const draft = drafts.current.get(id);

            if (draft !== undefined) {
                drafts.current.set(id, change(draft));
            }

            setTurns((current) =>
                current.map((turn) => (turn.id === id ? change(turn) : turn)),
            );
        };
        const stop = onAgentEvent(({ runId, kind, text: payload }) => {
            const runCli = runs.current.get(runId);

            if (runCli === undefined) {
                return;
            }

            if (kind === 'session') {
                sessions.current[runCli] = payload;

                if (
                    workspace.current !== null &&
                    conversation.current !== null
                ) {
                    void ide
                        .chatSaveSession(
                            workspace.current,
                            conversation.current,
                            runCli,
                            payload,
                        )
                        .catch(() => undefined);
                }
            } else if (kind === 'text') {
                update(runId, (turn) => ({
                    ...turn,
                    answer: turn.answer
                        ? `${turn.answer}\n\n${payload}`
                        : payload,
                }));
            } else if (kind === 'error') {
                update(runId, (turn) => ({ ...turn, error: payload }));
            } else {
                runs.current.delete(runId);
                update(runId, (turn) => ({ ...turn, running: false }));

                const finished = drafts.current.get(runId);

                if (finished !== undefined) {
                    persist(finished);
                    void recordUsage(finished).then(
                        (limited) => limited && failover.current?.(finished),
                    );
                    drafts.current.delete(runId);
                }
            }
        });

        return () => void stop.then((unlisten) => unlisten());
    }, []);

    useEffect(() => {
        bottom.current?.scrollIntoView({ block: 'end' });
    }, [turns]);

    // * A picked file goes into the message as `@path`: both CLIs read the file from that path.
    const addFiles = () =>
        void pickFiles().then((paths) => {
            if (paths.length === 0) {
                return;
            }

            setText(
                (current) =>
                    `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${paths.map((path) => `@${path}`).join('\n')} `,
            );
        });

    const releasePreview = (attachment: Attachment) => {
        if (attachment.preview !== null) {
            URL.revokeObjectURL(attachment.preview);
        }
    };

    // * Pasted images and files are saved by the backend; the message then points the CLI at them with `@path`.
    const pasteFiles = (files: File[]) => {
        setAttachError(null);
        files.forEach((file) =>
            ide
                .saveAttachment(file)
                .then((path) =>
                    setAttachments((current) => [
                        ...current,
                        {
                            id: `attachment-${attachmentCounter.current++}`,
                            name: file.name || 'tệp',
                            path,
                            preview: file.type.startsWith('image/')
                                ? URL.createObjectURL(file)
                                : null,
                        },
                    ]),
                )
                .catch((caught) => setAttachError(errorText(caught))),
        );
    };

    // * A path on disk is attached as it is: nothing to copy.
    const pastePaths = (paths: string[]) => {
        setAttachError(null);
        setAttachments((current) => [
            ...current,
            ...paths.map((path) => ({
                id: `attachment-${attachmentCounter.current++}`,
                name: path.split('/').pop() ?? path,
                path,
                preview: null,
            })),
        ]);
    };

    const removeAttachment = (id: string) => {
        const removed = attachments.find((item) => item.id === id);

        if (removed !== undefined) {
            releasePreview(removed);
        }

        setAttachments((current) => current.filter((item) => item.id !== id));
    };

    const startTurn = (
        prompt: string,
        target: AgentCli,
        tried: AgentCli[],
        fromComposer: boolean,
    ) => {
        // * Unique across restarts: saved turns keep their ids.
        const id = `run-${Date.now().toString(36)}-${counter.current++}`;
        const turn: Turn = {
            id,
            prompt,
            answer: '',
            error: null,
            running: true,
            cli: target,
        };

        runs.current.set(id, target);
        chains.current.set(id, tried);
        drafts.current.set(id, turn);

        if (fromComposer) {
            setText('');
            attachments.forEach(releasePreview);
            setAttachments([]);
            setAttachError(null);
        }

        setTurns((current) => [...current, turn]);
        ide.agentSend(
            id,
            target,
            prompt,
            sessions.current[target] ?? null,
            models[target] ?? null,
            target === 'claude' ? mode : null,
            target === 'claude' && agentTeam,
        ).catch((caught) => {
            runs.current.delete(id);
            drafts.current.delete(id);

            const failed = {
                ...turn,
                error: errorText(caught),
                running: false,
            };

            setTurns((current) =>
                current.map((item) => (item.id === id ? failed : item)),
            );
            persist(failed);
            recordUsage(failed);
        });
    };

    const send = () => {
        const prompt = [
            text.trim(),
            ...attachments.map((attachment) => `@${attachment.path}`),
        ]
            .filter((part) => part !== '')
            .join('\n');

        if (prompt === '' || busy) {
            return;
        }

        startTurn(prompt, cli, [], true);
    };

    // * A turn that ended on a limit error is sent again to the next AI of the saved order; when none is left the turn says so.
    useEffect(() => {
        failover.current = (finished) => {
            void ideSettings
                .get()
                .then((settings) => {
                    if (!settings.fallbackEnabled || busy) {
                        return;
                    }

                    const tried = [
                        ...(chains.current.get(finished.id) ?? []),
                        finished.cli,
                    ];
                    const next = settings.fallbackOrder.find(
                        (candidate) => !tried.includes(candidate),
                    );

                    if (next === undefined) {
                        const exhausted = {
                            ...finished,
                            running: false,
                            error: `${finished.error ?? ''}\nTất cả AI trong danh sách đã hết hạn mức.`.trim(),
                        };

                        setTurns((current) =>
                            current.map((turn) =>
                                turn.id === finished.id ? exhausted : turn,
                            ),
                        );
                        persist(exhausted);

                        return;
                    }

                    setCli(next);
                    startTurn(finished.prompt, next, tried, false);
                })
                .catch(() => undefined);
        };
    });

    return (
        <section
            aria-label="Trò chuyện với AI"
            style={fill ? undefined : { width: width.width }}
            className={cn(
                'relative flex min-h-0 flex-col',
                // * The chat gives way: when the editor or the file column is dragged out to the full width it shrinks away (and clips) instead of pushing the sidebar off the screen.
                fill
                    ? 'max-w-full min-w-0 flex-1'
                    : 'max-w-full min-w-[14rem] shrink-0 border-r',
            )}
        >
            {!fill && (
                <ResizeHandle
                    label="Đổi độ rộng khung chat"
                    className="right-0 left-auto translate-x-1/2"
                    {...width.handleProps}
                />
            )}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
                {/* * One centred column, as wide as the message box: a wide panel keeps lines readable instead of pushing the two sides apart. */}
                <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6">
                    {turns.length === 0 && (
                        <div className="flex flex-col items-center gap-3 pt-[20vh] text-center">
                            <img src={logo} alt="" className="size-12" />
                            <p className="text-sm text-muted-foreground">
                                Nhắn tin để làm việc với AI trong dự án này.
                            </p>
                        </div>
                    )}
                    {turns.map((turn) => (
                        <TurnView key={turn.id} turn={turn} />
                    ))}
                    <div ref={bottom} />
                </div>
            </div>
            <Composer
                project={null}
                onClearProject={() => undefined}
                value={text}
                onChange={setText}
                onSubmit={send}
                busy={busy}
                cli={cli}
                model={models[cli] ?? null}
                mode={mode}
                onModeChange={setMode}
                agentTeam={agentTeam}
                onAgentTeamChange={setAgentTeam}
                onChoose={(chosen, model) => {
                    setCli(chosen);
                    setModels((all) => ({
                        ...all,
                        [chosen]: model ?? undefined,
                    }));
                }}
                onAddFiles={addFiles}
                attachments={attachments}
                attachError={attachError}
                onPasteFiles={pasteFiles}
                onPastePaths={pastePaths}
                onRemoveAttachment={removeAttachment}
            />
        </section>
    );
}
