import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PermissionRequest, Turn } from '@/components/shell/chat/turn';
import {
    parsePayload,
    withDelta,
    withSubtext,
    withText,
    withToolCall,
    withToolResult,
} from '@/components/shell/chat/turn-events';
import type {
    SubagentEvent,
    SubtextEvent,
    ToolCallEvent,
    ToolResultEvent,
} from '@/components/shell/chat/turn-events';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';
import { errorText, ide, onAgentEvent, onRemoteSend } from '@/lib/ide';
import { ideAuth } from '@/lib/ide-auth';
import { ideProfiles } from '@/lib/ide-profiles';
import { ideSettings } from '@/lib/ide-settings';
import { ideUsage } from '@/lib/ide-usage';
import type { AgentCli, ChangedFile, Subagent } from '@/lib/ide';
import { t } from '@/lib/i18n';

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

/** Sends the messages to the AI CLI and follows each turn while it runs: streams its events into the turns, saves each turn, and moves a turn that hit a limit to the next AI. */
/** What identifies the state of a changed file: it differs when the file changed again. */
function changeSignature(file: ChangedFile): string {
    return `${file.status}:${file.added}:${file.removed}`;
}

export function useAgentTurns({
    root,
    projects,
    cli,
    onCli,
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
    onCli: (cli: AgentCli) => void;
    models: Partial<Record<AgentCli, string>>;
    mode: string;
    agentTeam: boolean;
    extraRoots: string[];
    worktree: boolean;
    acceptsRemote: boolean;
    session: {
        busy: boolean;
        setTurns: Dispatch<SetStateAction<Turn[]>>;
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
    // * Set after each render: the agent events are listened to once, and the move to the next AI needs the latest state.
    const failover = useRef<((finished: Turn) => void) | null>(null);
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
                            ? JSON.stringify(turn.steps)
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
                        setSubagents((current) =>
                            current.some((agent) => agent.id === started.id)
                                ? current
                                : [...current, { ...started, done: false }],
                        );
                    }

                    break;
                }
                case 'subagentdone':
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
                case 'error':
                    update(runId, (turn) => ({ ...turn, error: payload }));
                    break;
                default: {
                    runs.current.delete(runId);
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
                        void recordUsage(finished).then(
                            (limited) =>
                                limited && failover.current?.(finished),
                        );
                        drafts.current.delete(runId);
                    }
                }
            }
        });

        return () => void stop.then((unlisten) => unlisten());
    }, [
        setTurns,
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
        setSubagents([]);
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
        void readChanges()
            .then((files) =>
                before.current.set(
                    id,
                    new Map(
                        files.map((file) => [file.path, changeSignature(file)]),
                    ),
                ),
            )
            .catch(() => undefined);
        // * Saved at once, then again when the turn ends: a message is not lost when the answer never finishes (the app is closed, the CLI stalls).
        persist(turn);
        ide.agentSend(
            id,
            target,
            prompt,
            sessions.current[target] ?? null,
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

    // * A picked option (or the typed "Khác…" answer) is the next message; `choose` stays the same function so the memoised turns do not re-render.
    const choose = useStableCallback((picked: string) => {
        if (!busy) {
            startTurn(picked, cli, [], false);
        }
    });

    /** The message typed in the box (and its attachments) goes to the chosen AI; ignored while a turn runs. */
    const sendFromComposer = useStableCallback((prompt: string) => {
        if (prompt === '' || busy) {
            return;
        }

        startTurn(prompt, cli, [], true);
    });

    // * A message from the phone app is sent as if it was typed here; one that arrives while a turn runs is ignored.
    const remoteSend = useStableCallback((prompt: string) => {
        if (acceptsRemote && !busy && prompt.trim() !== '') {
            startTurn(prompt.trim(), cli, [], true);
        }
    });

    useEffect(() => {
        const stop = onRemoteSend((prompt) => remoteSend(prompt));

        return () => void stop.then((unlisten) => unlisten());
    }, [remoteSend]);

    // * A turn that ended on a limit error is sent again to the next AI of the saved order; when none is left the turn says so.
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

    useEffect(() => {
        failover.current = (finished) => {
            const triedAccounts = accountChains.current.get(finished.id) ?? [];

            void nextAccount(finished, triedAccounts)
                .catch(() => null)
                .then(async (account) => {
                    if (account === null) {
                        return false;
                    }

                    await ideProfiles.select(finished.cli, account);
                    // * A saved conversation belongs to the account that started it, so the new account starts a fresh one.
                    delete sessions.current[finished.cli];
                    startTurn(
                        finished.prompt,
                        finished.cli,
                        chains.current.get(finished.id) ?? [],
                        false,
                        [...triedAccounts, account],
                    );

                    return true;
                })
                .catch(() => false)
                .then((switched) => (switched ? undefined : ideSettings.get()))
                .then((settings) => {
                    if (
                        settings === undefined ||
                        !settings.fallbackEnabled ||
                        busy
                    ) {
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
                            error: `${finished.error ?? ''}\n${t('use_agent_turns.all_ais_in_the')}`.trim(),
                        };

                        setTurns((current) =>
                            current.map((turn) =>
                                turn.id === finished.id ? exhausted : turn,
                            ),
                        );
                        persist(exhausted);

                        return;
                    }

                    onCli(next);
                    startTurn(finished.prompt, next, tried, false);
                })
                .catch(() => undefined);
        };
    });

    return {
        choose,
        sendFromComposer,
        switchAccount,
        answerPermission,
        stopTurns,
    };
}
