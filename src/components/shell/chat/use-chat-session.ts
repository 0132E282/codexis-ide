import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ContextUsage } from '@/components/shell/chat/turn-events';
import { restoreContext, restoreTurns } from '@/components/shell/chat/turn';
import type { Turn } from '@/components/shell/chat/turn';
import { ide } from '@/lib/ide';
import type { AgentCli, Subagent } from '@/lib/ide';

type SessionSnapshot = {
    turns: Turn[];
    subagents: Subagent[];
    context: ContextUsage | null;
};

type SharedSession = {
    snapshot: SessionSnapshot;
    listeners: Set<() => void>;
    sessions: MutableRefObject<Partial<Record<AgentCli, string>>>;
    workspace: MutableRefObject<string | null>;
    conversation: MutableRefObject<number | null>;
    loaded: boolean;
    loading: boolean;
};

const sharedSessions = new Map<string, SharedSession>();

const sessionKey = (root: string, conversation: number | null) =>
    `${root}\u0000${conversation ?? 'current'}`;

function createSharedSession(conversation: number | null): SharedSession {
    return {
        snapshot: { turns: [], subagents: [], context: null },
        listeners: new Set(),
        sessions: { current: {} },
        workspace: { current: null },
        conversation: { current: conversation },
        loaded: false,
        loading: false,
    };
}

function getSharedSession(root: string, conversation: number | null) {
    const key = sessionKey(root, conversation);
    let shared = sharedSessions.get(key);

    if (shared === undefined) {
        shared = createSharedSession(conversation);
        sharedSessions.set(key, shared);
    }

    return shared;
}

function aliasSession(
    root: string,
    conversation: number,
    shared: SharedSession,
) {
    const prefix = `${root}\u0000`;

    for (const [key, value] of sharedSessions) {
        if (
            value === shared &&
            key.startsWith(prefix) &&
            key !== sessionKey(root, null) &&
            key !== sessionKey(root, conversation)
        ) {
            sharedSessions.delete(key);
        }
    }

    sharedSessions.set(sessionKey(root, conversation), shared);
}

function publish(shared: SharedSession, snapshot: SessionSnapshot) {
    shared.snapshot = snapshot;

    for (const listener of shared.listeners) {
        listener();
    }
}

/** The saved conversation of a project: loads it, opens another one from the sidebar, starts a new one, and holds the turns and sub-agents shown. */
export function useChatSession({
    root,
    newChat,
    openConversation,
    onConversation,
    onChanged,
    onSubagents,
    onRestoreCli,
    onReset,
}: {
    root: string;
    newChat: number;
    openConversation: { id: number; n: number } | null;
    onConversation: (id: number) => void;
    onChanged: () => void;
    onSubagents: (subagents: Subagent[]) => void;
    /** The AI of the last turn of a loaded conversation is the one picked again. */
    onRestoreCli: (cli: AgentCli) => void;
    /** Another conversation is shown: what was typed for the old one (attachments) goes. */
    onReset: () => void;
}) {
    const requestedConversation = openConversation?.id ?? null;
    const requestedKey = `${root}\u0000${requestedConversation ?? 'current'}\u0000${openConversation?.n ?? 0}`;
    const requestedSession = getSharedSession(root, requestedConversation);
    const selected = useRef({
        root,
        key: requestedKey,
        ignoredKey: null as string | null,
        shared: requestedSession,
    });

    if (selected.current.root !== root) {
        selected.current = {
            root,
            key: requestedKey,
            ignoredKey: null,
            shared: requestedSession,
        };
    } else if (selected.current.key !== requestedKey) {
        selected.current.key = requestedKey;

        if (
            selected.current.shared.snapshot.turns.some((turn) => turn.running)
        ) {
            selected.current.ignoredKey = requestedKey;
        } else {
            selected.current.ignoredKey = null;
            selected.current.shared = requestedSession;
        }
    } else if (
        selected.current.ignoredKey !== requestedKey &&
        selected.current.shared !== requestedSession &&
        !selected.current.shared.snapshot.turns.some((turn) => turn.running)
    ) {
        selected.current.shared = requestedSession;
    }

    const shared = selected.current.shared;
    const snapshot = useSyncExternalStore(
        (listener) => {
            shared.listeners.add(listener);

            return () => shared.listeners.delete(listener);
        },
        () => shared.snapshot,
        () => shared.snapshot,
    );
    const { turns, subagents, context } = snapshot;
    const setTurns: Dispatch<SetStateAction<Turn[]>> = useCallback(
        (change) =>
            publish(shared, {
                ...shared.snapshot,
                turns:
                    typeof change === 'function'
                        ? change(shared.snapshot.turns)
                        : change,
            }),
        [shared],
    );
    const setContext: Dispatch<SetStateAction<ContextUsage | null>> =
        useCallback(
            (change) =>
                publish(shared, {
                    ...shared.snapshot,
                    context:
                        typeof change === 'function'
                            ? change(shared.snapshot.context)
                            : change,
                }),
            [shared],
        );
    const setSubagents: Dispatch<SetStateAction<Subagent[]>> = useCallback(
        (change) =>
            publish(shared, {
                ...shared.snapshot,
                subagents:
                    typeof change === 'function'
                        ? change(shared.snapshot.subagents)
                        : change,
            }),
        [shared],
    );
    const notifyConversation = useCallback(
        (id: number) => {
            shared.conversation.current = id;
            aliasSession(root, id, shared);
            onConversation(id);
        },
        [onConversation, root, shared],
    );
    const notifyChanged = onChanged;
    const busy = turns.some((turn) => turn.running);

    useEffect(() => {
        if (shared.loaded || shared.loading) {
            return;
        }

        shared.loading = true;
        const load =
            openConversation?.id === undefined
                ? ide.chatLoad(undefined, root)
                : ide.chatLoad(openConversation.id, root);

        void load
            .then((history) => {
                if (shared.loaded) {
                    return;
                }

                shared.workspace.current = history.workspace;
                shared.conversation.current = history.conversation;
                shared.sessions.current = { ...history.sessions };
                const last = history.turns.at(-1);

                if (last !== undefined) {
                    onRestoreCli(last.cli);
                }

                publish(shared, {
                    turns: restoreTurns(history),
                    subagents: [],
                    context: restoreContext(history),
                });
                shared.loaded = true;
                if (openConversation !== null) {
                    onReset();
                }
                notifyConversation(history.conversation);
            })
            .catch(() => {
                // * No saved history: the chat still works, it is just not kept.
                shared.loaded = true;
            })
            .finally(() => {
                shared.loading = false;
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shared]);

    useEffect(() => {
        onSubagents(subagents);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subagents]);

    /** Opens an empty conversation: the next turn has no session, so none of the old history is sent. Not while a turn is being answered (it would be saved into the new conversation); returns whether it started. */
    const startNewChat = () => {
        if (busy || shared.workspace.current === null) {
            return false;
        }

        void ide
            .chatNew(shared.workspace.current)
            .then((id) => {
                shared.conversation.current = id;
                shared.sessions.current = {};
                shared.loaded = true;
                aliasSession(root, id, shared);
                publish(shared, { turns: [], subagents: [], context: null });
                onReset();
                onConversation(id);
                onChanged();
            })
            .catch(() => undefined);

        return true;
    };

    const handledNewChat = useRef(newChat);

    useEffect(() => {
        if (newChat === handledNewChat.current) {
            return;
        }

        handledNewChat.current = newChat;
        startNewChat();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newChat]);

    return {
        turns,
        subagents,
        setTurns,
        context,
        setContext,
        setSubagents,
        busy,
        sessions: shared.sessions,
        workspace: shared.workspace,
        conversation: shared.conversation,
        notifyChanged,
        startNewChat,
    };
}
