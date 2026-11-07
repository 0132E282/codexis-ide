import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PermissionRequest, Turn } from '@/components/shell/chat/turn';
import {
    parsePayload,
    withDelta,
    withPlan,
    withSpeaker,
    withSubtext,
    withText,
    withToolCall,
    withToolResult,
} from '@/components/shell/chat/turn-events';
import type {
    ContextUsage,
    PlanEvent,
    SubagentEvent,
    SubtextEvent,
    ToolCallEvent,
    ToolResultEvent,
} from '@/components/shell/chat/turn-events';
import type { PlanData } from '@/components/shell/plan-pane';
import { waitForSession } from '@/components/shell/chat/session-wait';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';
import { errorText, ide, onAgentEvent, onRemoteSend } from '@/lib/ide';
import { ideAuth } from '@/lib/ide-auth';
import { ideProfiles } from '@/lib/ide-profiles';
import { ideUsage } from '@/lib/ide-usage';
import type { AgentCli, ChangedFile, Subagent } from '@/lib/ide';
import { t, translateError } from '@/lib/i18n';

/** A message that waits for the running turn: with the AI chosen when it was typed and the conversation it was typed in (null: not loaded yet). */
type Waiting = {
    prompt: string;
    cli: AgentCli;
    conversation: number | null;
};

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

// * The other signed-in accounts of the same AI that have not hit a limit come first; the AI itself changes only when none is left.
const nextAccount = async (
    finished: Turn,
    triedAccounts: number[],
): Promise<number | null> => {
    const all = await ideProfiles.list();
    const mine = all.filter((profile) => profile.cli === finished.cli);
    const current = mine.find((profile) => profile.active)?.id;
    const skipped = [
        ...triedAccounts,
        ...(current === undefined ? [] : [current]),
    ];

    for (const profile of mine) {
        if (skipped.includes(profile.id)) {
            continue;
        }

        const [status, usage] = await Promise.all([
            ideAuth.statusProfile(finished.cli, profile.id),
            ideUsage.statsProfile(finished.cli, profile.id),
        ]);

        if (status.loggedIn && !usage.limitReached) {
            return profile.id;
        }
    }

    return null;
};

/** What identifies the state of a changed file: it differs when the file changed again. */
function changeSignature(file: ChangedFile): string {
    return `${file.status}:${file.added}:${file.removed}`;
}

/** Sends the messages to the AI CLI and follows each turn while it runs: streams its events into the turns, saves each turn. */
export function useAgentTurns({
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
    onComposerSent,
}: {
    root: string;
    projects: { root: string; name: string }[];
    cli: AgentCli;
    models: Partial<Record<AgentCli, string>>;
    mode: string;
    agentTeam: boolean;
    extraRoots: string[];
    worktree: boolean;
    acceptsRemote: boolean;
    session: {
        busy: boolean;
        setTurns: Dispatch<SetStateAction<Turn[]>>;
        setContext: Dispatch<SetStateAction<ContextUsage | null>>;
        setPlan: Dispatch<SetStateAction<PlanData | null>>;
        setSubagents: Dispatch<SetStateAction<Subagent[]>>;
        sessions: MutableRefObject<Partial<Record<AgentCli, string>>>;
        workspace: MutableRefObject<string | null>;
        conversation: MutableRefObject<number | null>;
        notifyChanged: () => void;
    };
    /** A message typed in the box was sent: the box is emptied. */
    onComposerSent: () => void;
}) {
    const {
        busy,
        setTurns,
        setContext,
        setPlan,
        setSubagents,
        sessions,
        workspace,
        conversation,
        notifyChanged,
    } = session;
    const runs = useRef(new Map<string, AgentCli>());
    // * Turns being answered, updated at once (state is not): the finished turn is saved from here.
    const drafts = useRef(new Map<string, Turn>());
    // * The CLIs already tried for a message that is being moved from one AI to the next, by turn id.
    const chains = useRef(new Map<string, AgentCli[]>());
    // * The accounts of the same AI already tried for that message, by turn id.
    const accountChains = useRef(new Map<string, number[]>());
    // * Sub-agents of the running turns that are not done yet: only while there are some does a message sent meanwhile start its own turn.
    const working = useRef(new Set<string>());
    // * Messages sent while a turn runs without sub-agents: they wait and go as one message when the chat is free or a sub-agent starts. Each keeps the AI chosen when it was typed and the conversation it belongs to; the ref is read at once, the state is what the box shows.
    const queued = useRef<Waiting[]>([]);
    const [waiting, setWaiting] = useState<Waiting[]>([]);
    const keepQueue = (next: Waiting[]) => {
        queued.current = next;
        setWaiting(next);
    };
    // * Set after each render : the events are listened to once, and sending needs the latest state.
    const flushQueue = useRef<(() => void) | null>(null);
    // * Turns waiting (a few seconds at most) for the session id of the turn that is still starting: a `session` event wakes them.
    const sessionWaiters = useRef(new Set<() => void>());
    const counter = useRef(0);
    // * What git said was changed when each turn started, by turn id: the turn's own changes are the difference.
    const readChanges = useStableCallback(() => ide.localChanges(root));
    const before = useRef(new Map<string, Map<string, string>>());

    const persist = useStableCallback((turn: Turn) => {
        if (workspace.current !== null && conversation.current !== null) {
            void ide
                .chatSaveTurn(workspace.current, conversation.current, {
                    id: turn.id,
                    cli: turn.cli,
                    prompt: turn.prompt,
                    answer: turn.answer,
                    error: turn.error,
                    steps:
                        turn.steps !== undefined && turn.steps.length > 0
                            ? // * Pictures of tool results are shown live only: saved, they could pass the size limit of a turn.
                              JSON.stringify(turn.steps, (key, value) =>
                                  key === 'images' ? undefined : value,
                              )
                            : null,
                })
                .then(() => notifyChanged())
                .catch((caught) => console.error(errorText(caught)));
        } else {
            console.error(t('use_agent_turns.could_not_save_the'));
        }
    });

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

            switch (kind) {
                case 'session':
                    sessions.current[runCli] = payload;

                    for (const resume of sessionWaiters.current) {
                        resume();
                    }

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

                    break;
                case 'text':
                    update(runId, (turn) => withText(turn, payload));
                    break;
                case 'delta':
                    update(runId, (turn) => withDelta(turn, payload));
                    break;
                case 'tool': {
                    const call = parsePayload<ToolCallEvent>(payload);

                    if (call !== null) {
                        update(runId, (turn) => withToolCall(turn, call));
                    }

                    break;
                }
                case 'toolresult': {
                    const result = parsePayload<ToolResultEvent>(payload);

                    if (result !== null) {
                        update(runId, (turn) => withToolResult(turn, result));
                    }

                    break;
                }
                case 'subtext': {
                    const spoken = parsePayload<SubtextEvent>(payload);

                    if (spoken !== null) {
                        update(runId, (turn) => withSubtext(turn, spoken));
                    }

                    break;
                }
                case 'subagent': {
                    const started = parsePayload<SubagentEvent>(payload);

                    if (started !== null) {
                        working.current.add(started.id);
                        flushQueue.current?.();
                        setSubagents((current) =>
                            current.some((agent) => agent.id === started.id)
                                ? current
                                : [...current, { ...started, done: false }],
                        );
                    }

                    break;
                }
                case 'subagentdone':
                    working.current.delete(payload);
                    setSubagents((current) =>
                        current.map((agent) =>
                            agent.id === payload
                                ? { ...agent, done: true }
                                : agent,
                        ),
                    );
                    break;
                case 'permission': {
                    const asked = parsePayload<PermissionRequest>(payload);

                    if (asked !== null) {
                        update(runId, (turn) => ({
                            ...turn,
                            permissions: [...(turn.permissions ?? []), asked],
                        }));
                    }

                    break;
                }
                case 'plan': {
                    const written = parsePayload<PlanEvent>(payload);

                    if (written !== null) {
                        setPlan((current) => withPlan(current, written));
                    }

                    break;
                }
                case 'context': {
                    const usage = parsePayload<ContextUsage>(payload);

                    if (usage !== null) {
                        setContext(usage);
                    }

                    break;
                }
                case 'speaker':
                    if (payload === 'claude' || payload === 'codex') {
                        update(runId, (turn) => withSpeaker(turn, payload));
                    }

                    break;
                case 'error':
                    update(runId, (turn) => ({
                        ...turn,
                        error: translateError(payload),
                    }));
                    break;
                case 'background':
                    // * Announced mid-turn (handled by the background-tasks hook); it must not end the turn.
                    break;
                // * `result`: the answer is complete, so the chat is free even if the CLI process lingers for sub-agents or background tasks; the `done` after it is ignored.
                case 'result':
                default: {
                    runs.current.delete(runId);
                    working.current.clear();
                    // * They stay listed (done) until the next message starts; a turn that ends cannot leave one "working".
                    setSubagents((current) =>
                        current.map((agent) => ({ ...agent, done: true })),
                    );
                    update(runId, (turn) => ({
                        ...turn,
                        running: false,
                        permissions: undefined,
                    }));

                    const finished = drafts.current.get(runId);
                    const baseline = before.current.get(runId);

                    before.current.delete(runId);

                    if (baseline !== undefined) {
                        void readChanges()
                            .then((files) => {
                                const changed = files.filter(
                                    (file) =>
                                        baseline.get(file.path) !==
                                        changeSignature(file),
                                );

                                if (changed.length > 0) {
                                    setTurns((current) =>
                                        current.map((turn) =>
                                            turn.id === runId
                                                ? { ...turn, changed }
                                                : turn,
                                        ),
                                    );
                                }
                            })
                            .catch(() => undefined);
                    }

                    if (finished !== undefined) {
                        persist(finished);
                        void recordUsage(finished).then((limited) => {
                            if (!limited) {
                                flushQueue.current?.();
                            }
                        });
                        drafts.current.delete(runId);
                    } else {
                        flushQueue.current?.();
                    }
                }
            }
        });

        return () => void stop.then((unlisten) => unlisten());
    }, [
        setTurns,
        setContext,
        setSubagents,
        sessions,
        workspace,
        conversation,
        persist,
        readChanges,
    ]);

    const startTurn = (
        prompt: string,
        target: AgentCli,
        tried: AgentCli[],
        fromComposer: boolean,
        triedAccounts: number[] = [],
    ) => {
        // * Another turn is already running: this one forks its session and does not attribute file changes.
        const overlapping = runs.current.size > 0;

        // * Not while another turn runs: it would wipe the sub-agents that turn started.
        if (!overlapping) {
            setSubagents([]);
        }

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
        accountChains.current.set(id, triedAccounts);
        drafts.current.set(id, turn);

        if (fromComposer) {
            onComposerSent();
        }

        setTurns((current) => [...current, turn]);

        // * Overlapping turns edit the same files: no baseline, so none of them claims the other's changes.
        if (!overlapping) {
            void readChanges()
                .then((files) =>
                    before.current.set(
                        id,
                        new Map(
                            files.map((file) => [
                                file.path,
                                changeSignature(file),
                            ]),
                        ),
                    ),
                )
                .catch(() => undefined);
        }
        // * Saved at once, then again when the turn ends: a message is not lost when the answer never finishes (the app is closed, the CLI stalls).
        persist(turn);
        // * The first turn has no session id yet: wait for it up to 3 seconds, then start a new session.
        const sessionKnown = waitForSession(
            sessionWaiters.current,
            () => !overlapping || sessions.current[target] !== undefined,
        );

        void sessionKnown
            .then(() => {
                const session = sessions.current[target] ?? null;

                return ide.agentSend(
                    id,
                    target,
                    prompt,
                    session,
                    models[target] ?? null,
                    target === 'claude' ? mode : null,
                    target === 'claude' && agentTeam,
                    root,
                    extraRoots.filter((extra) =>
                        projects.some((project) => project.root === extra),
                    ),
                    worktree && conversation.current !== null
                        ? `c${conversation.current}`
                        : undefined,
                    // * Only Claude can fork; another turn running (besides this one) means the session is in use.
                    target === 'claude' &&
                        session !== null &&
                        runs.current.size > 1,
                );
            })
            .catch((caught) => {
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

    // * A picked option (or the typed "Khác…" answer) is the next message; `choose` stays the same function so the memoised turns do not re-render.
    const choose = useStableCallback((picked: string) => {
        startTurn(picked, cli, [], false);
    });

    // * While a turn runs, a message goes at once (its own turn) only if that turn has sub-agents working; otherwise it waits in the queue.
    const send = (prompt: string, fromComposer = true) => {
        if (runs.current.size > 0 && working.current.size === 0) {
            keepQueue([
                ...queued.current,
                { prompt, cli, conversation: conversation.current },
            ]);

            return;
        }

        startTurn(prompt, cli, [], fromComposer);
    };

    // * Sends the waiting messages as one: when the chat is free or a sub-agent starts.
    const flush = () => {
        if (
            queued.current.length > 0 &&
            (runs.current.size === 0 || working.current.size > 0)
        ) {
            // * One AI per message: the first messages that share an AI go together, the rest wait for the next flush.
            const [first] = queued.current;
            const other = queued.current.findIndex(
                (item) => item.cli !== first.cli,
            );
            const group = queued.current.slice(
                0,
                other === -1 ? undefined : other,
            );

            keepQueue(queued.current.slice(group.length));
            startTurn(
                group.map((item) => item.prompt).join('\n\n'),
                first.cli,
                [],
                true,
            );
        }
    };

    useEffect(() => {
        flushQueue.current = flush;

        // * Another conversation was opened or started: its messages are not for this one.
        const stale = (item: Waiting) =>
            item.conversation !== null &&
            item.conversation !== conversation.current;

        if (queued.current.some(stale)) {
            keepQueue(queued.current.filter((item) => !stale(item)));
        }
    });

    /** The message typed in the box (and its attachments) goes to the chosen AI: at once when the chat is free or a sub-agent works (each turn has its own run id, so their events never mix), else it waits for the running turn. */
    const sendFromComposer = useStableCallback((prompt: string) => {
        if (prompt !== '') {
            send(prompt);
        }
    });

    /** A message that did not come from the box (a button): sent like a typed one, but the draft in the box stays. */
    const sendPrompt = useStableCallback((prompt: string) => {
        if (prompt !== '') {
            send(prompt, false);
        }
    });

    const clearWaiting = useStableCallback(() => keepQueue([]));

    // * A message from the phone app is sent as if it was typed here.
    const remoteSend = useStableCallback((prompt: string) => {
        if (acceptsRemote && prompt.trim() !== '') {
            send(prompt.trim());
        }
    });

    useEffect(() => {
        const stop = onRemoteSend((prompt) => remoteSend(prompt));

        return () => void stop.then((unlisten) => unlisten());
    }, [remoteSend]);

    /** Ctrl+C in the box: stops the running turns; each finishes with what it had. */
    const stopTurns = useStableCallback(() => {
        for (const runId of runs.current.keys()) {
            ide.agentStop(runId).catch((caught) =>
                console.error(errorText(caught)),
            );
        }
    });

    /** The "Cho phép" / "Từ chối" buttons: answers the AI's first waiting question of this turn. */
    const answerPermission = useStableCallback(
        (turn: Turn, request: PermissionRequest, allow: boolean) => {
            void ide
                .agentPermission(turn.id, request.id, allow, request.input)
                .catch((caught) => console.error(errorText(caught)));

            const answered = (current: Turn): Turn => ({
                ...current,
                permissions: current.permissions?.filter(
                    (item) => item.id !== request.id,
                ),
            });
            const draft = drafts.current.get(turn.id);

            if (draft !== undefined) {
                drafts.current.set(turn.id, answered(draft));
            }

            setTurns((current) =>
                current.map((item) =>
                    item.id === turn.id ? answered(item) : item,
                ),
            );
        },
    );

    /** The "Chuyển tài khoản" button: the last message goes again under another signed-in account of the same AI that has not hit a limit. */
    const switchAccount = useStableCallback((finished: Turn) => {
        if (busy) {
            return;
        }

        const triedAccounts = accountChains.current.get(finished.id) ?? [];

        void nextAccount(finished, triedAccounts)
            .then(async (account) => {
                if (account === null) {
                    const exhausted = {
                        ...finished,
                        error: `${finished.error ?? ''}\n${t('use_agent_turns.no_other_account_has')}`.trim(),
                    };

                    setTurns((current) =>
                        current.map((turn) =>
                            turn.id === finished.id ? exhausted : turn,
                        ),
                    );

                    return;
                }

                await ideProfiles.select(finished.cli, account);
                delete sessions.current[finished.cli];
                startTurn(
                    finished.prompt,
                    finished.cli,
                    chains.current.get(finished.id) ?? [],
                    false,
                    [...triedAccounts, account],
                );
            })
            .catch((caught) => console.error(errorText(caught)));
    });

    return {
        waiting,
        clearWaiting,
        choose,
        sendFromComposer,
        sendPrompt,
        switchAccount,
        answerPermission,
        stopTurns,
    };
}
