import { useCallback, useEffect, useRef, useState } from 'react';
import type { Turn } from '@/components/shell/chat/turn';
import {
    parsePayload,
    withDelta,
    withSubtext,
    withText,
    withToolCall,
    withToolResult,
} from '@/components/shell/chat/turn-events';
import type {
    SubtextEvent,
    ToolCallEvent,
    ToolResultEvent,
} from '@/components/shell/chat/turn-events';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';
import { errorText, ide, onAgentEvent } from '@/lib/ide';
import { translateError } from '@/lib/i18n';

// * Side chat runs only read: the Claude CLI's plan mode. Codex has no such mode, so it is not offered.
const READ_ONLY_MODE = 'plan';
// * `remote.rs` does not forward events of runs with this prefix to the phone.
const RUN_PREFIX = 'side-';

/** One side chat tab: its own conversation, kept in memory only (nothing is saved, nothing is listed in the sidebar). */
export type SideTab = {
    id: string;
    /** Shown as "Side chat <number>"; numbers only go up during the session. */
    number: number;
    turns: Turn[];
    /** Session id of the CLI: the next question continues the same conversation. */
    sessionId: string | null;
    running: boolean;
};

const makeTab = (number: number): SideTab => ({
    id: `${RUN_PREFIX}tab-${crypto.randomUUID()}`,
    number,
    turns: [],
    sessionId: null,
    running: false,
});

/** The side chat of one project: several tabs, each asking the Claude CLI read-only through `agent_send`, in runs named `side-<uuid>` so the main chat ignores them. */
export function useSideChat(root: string) {
    const counter = useRef(1);
    const [tabs, setTabs] = useState<SideTab[]>(() => [makeTab(1)]);
    const [activeId, setActiveId] = useState<string | null>(() => tabs[0].id);
    // * Runs being answered: run id → tab id. Events of any other run (the main chat's) are not ours.
    const runs = useRef(new Map<string, string>());

    useEffect(() => {
        const updateTab = (tabId: string, change: (tab: SideTab) => SideTab) =>
            setTabs((current) =>
                current.map((tab) => (tab.id === tabId ? change(tab) : tab)),
            );
        const updateTurn = (
            runId: string,
            tabId: string,
            change: (turn: Turn) => Turn,
        ) =>
            updateTab(tabId, (tab) => ({
                ...tab,
                turns: tab.turns.map((turn) =>
                    turn.id === runId ? change(turn) : turn,
                ),
            }));
        const stop = onAgentEvent(({ runId, kind, text: payload }) => {
            const tabId = runs.current.get(runId);

            if (tabId === undefined) {
                return;
            }

            switch (kind) {
                case 'session':
                    updateTab(tabId, (tab) => ({
                        ...tab,
                        sessionId: payload,
                    }));
                    break;
                case 'text':
                    updateTurn(runId, tabId, (turn) => withText(turn, payload));
                    break;
                case 'delta':
                    updateTurn(runId, tabId, (turn) =>
                        withDelta(turn, payload),
                    );
                    break;
                case 'tool': {
                    const call = parsePayload<ToolCallEvent>(payload);

                    if (call !== null) {
                        updateTurn(runId, tabId, (turn) =>
                            withToolCall(turn, call),
                        );
                    }

                    break;
                }
                case 'toolresult': {
                    const result = parsePayload<ToolResultEvent>(payload);

                    if (result !== null) {
                        updateTurn(runId, tabId, (turn) =>
                            withToolResult(turn, result),
                        );
                    }

                    break;
                }
                case 'subtext': {
                    const spoken = parsePayload<SubtextEvent>(payload);

                    if (spoken !== null) {
                        updateTurn(runId, tabId, (turn) =>
                            withSubtext(turn, spoken),
                        );
                    }

                    break;
                }
                case 'error':
                    updateTurn(runId, tabId, (turn) => ({
                        ...turn,
                        error: translateError(payload),
                    }));
                    break;
                case 'subagent':
                case 'subagentdone':
                case 'permission':
                case 'context':
                    // * Sub-agents, permission questions and context levels are out of scope for the side chat.
                    break;
                case 'done':
                    runs.current.delete(runId);
                    updateTurn(runId, tabId, (turn) => ({
                        ...turn,
                        running: false,
                    }));
                    updateTab(tabId, (tab) => ({ ...tab, running: false }));
                    break;
                default:
                    // * A kind this code does not know never ends the turn: only `done` does.
                    break;
            }
        });
        const liveRuns = runs.current;

        return () => {
            void stop.then((unlisten) => unlisten());

            // * The pane is gone: its running questions end with it.
            for (const runId of liveRuns.keys()) {
                void ide.agentStop(runId).catch(() => undefined);
            }

            liveRuns.clear();
        };
    }, []);

    const active =
        tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1];

    const add = useCallback(() => {
        counter.current += 1;

        const tab = makeTab(counter.current);

        setTabs((current) => [...current, tab]);
        setActiveId(tab.id);
    }, []);

    /** Closes a tab and stops its running question; closing the last tab leaves a fresh empty one. Returns true when it was the last. */
    const close = useStableCallback((id: string): boolean => {
        for (const [runId, tabId] of [...runs.current]) {
            if (tabId === id) {
                runs.current.delete(runId);
                void ide.agentStop(runId).catch(() => undefined);
            }
        }

        // * Only for the answer: whether this was the last tab, as the render this callback belongs to saw it.
        const wasLast = tabs.length === 1 && tabs[0].id === id;
        const fresh = makeTab(counter.current + 1);

        setTabs((current) => {
            const remaining = current.filter((tab) => tab.id !== id);

            if (remaining.length > 0) {
                return remaining;
            }

            // * Setting the same number twice (a repeated updater) changes nothing.
            counter.current = fresh.number;

            return [fresh];
        });
        // * The open tab closed: no tab is chosen, and the last one is shown.
        setActiveId((currentId) => (currentId === id ? null : currentId));

        return wasLast;
    });

    /** Asks the question in the open tab; ignored while that tab is answering. */
    const send = useStableCallback((prompt: string) => {
        const question = prompt.trim();

        if (question === '' || active.running) {
            return;
        }

        const tabId = active.id;
        const runId = `${RUN_PREFIX}${crypto.randomUUID()}`;
        const turn: Turn = {
            id: runId,
            prompt: question,
            answer: '',
            error: null,
            running: true,
            cli: 'claude',
        };

        runs.current.set(runId, tabId);
        setTabs((current) =>
            current.map((tab) =>
                tab.id === tabId
                    ? { ...tab, turns: [...tab.turns, turn], running: true }
                    : tab,
            ),
        );
        ide.agentSend(
            runId,
            'claude',
            question,
            active.sessionId,
            null,
            READ_ONLY_MODE,
            false,
            root,
            [],
            undefined,
        ).catch((caught) => {
            runs.current.delete(runId);
            setTabs((current) =>
                current.map((tab) =>
                    tab.id === tabId
                        ? {
                              ...tab,
                              running: false,
                              turns: tab.turns.map((item) =>
                                  item.id === runId
                                      ? {
                                            ...item,
                                            error: errorText(caught),
                                            running: false,
                                        }
                                      : item,
                              ),
                          }
                        : tab,
                ),
            );
        });
    });

    /** Stops the running question of the open tab; the turn finishes with what it had. */
    const stop = useStableCallback(() => {
        for (const [runId, tabId] of runs.current) {
            if (tabId === active.id) {
                void ide.agentStop(runId).catch(() => undefined);
            }
        }
    });

    return { tabs, active, select: setActiveId, add, close, send, stop };
}
