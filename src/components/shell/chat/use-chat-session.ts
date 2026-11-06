import { useEffect, useRef, useState } from 'react';
import { restoreTurns } from '@/components/shell/chat/turn';
import type { Turn } from '@/components/shell/chat/turn';
import { useStableCallback } from '@/components/shell/chat/use-stable-callback';
import { ide } from '@/lib/ide';
import type { AgentCli, ChatHistory, Subagent } from '@/lib/ide';

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
    openConversation: number | null;
    onConversation: (id: number) => void;
    onChanged: () => void;
    onSubagents: (subagents: Subagent[]) => void;
    /** The AI of the last turn of a loaded conversation is the one picked again. */
    onRestoreCli: (cli: AgentCli) => void;
    /** Another conversation is shown: what was typed for the old one (attachments) goes. */
    onReset: () => void;
}) {
    const [subagents, setSubagents] = useState<Subagent[]>([]);
    const [turns, setTurns] = useState<Turn[]>([]);
    // * One session per CLI: a Claude session id means nothing to Codex.
    const sessions = useRef<Partial<Record<AgentCli, string>>>({});
    // * Key of the saved history; null while it is not loaded (or could not be), and nothing is saved then.
    const workspace = useRef<string | null>(null);
    // * The conversation the turns are saved into; null until the history is loaded.
    const conversation = useRef<number | null>(null);
    const notifyConversation = useStableCallback(onConversation);
    const notifyChanged = useStableCallback(onChanged);
    const handledNewChat = useRef(newChat);
    const busy = turns.some((turn) => turn.running);

    useEffect(() => {
        onSubagents(subagents);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subagents]);

    // * Shows a loaded conversation: `replace` swaps the turns, otherwise they go before what was typed while it loaded.
    const apply = (history: ChatHistory, replace: boolean) => {
        workspace.current = history.workspace;
        conversation.current = history.conversation;
        sessions.current = replace
            ? { ...history.sessions }
            : { ...history.sessions, ...sessions.current };

        const last = history.turns.at(-1);

        if (last !== undefined) {
            onRestoreCli(last.cli);
        }

        const restored = restoreTurns(history);

        setTurns((current) => (replace ? restored : [...restored, ...current]));
        notifyConversation(history.conversation);
    };

    useEffect(() => {
        let cancelled = false;

        ide.chatLoad(undefined, root)
            .then((history) => !cancelled && apply(history, false))
            // * No saved history: the chat still works, it is just not kept.
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
            .chatLoad(openConversation, root)
            .then((history) => {
                apply(history, true);
                onReset();
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
                onReset();
                notifyConversation(id);
                notifyChanged();
            })
            .catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newChat]);

    return {
        turns,
        setTurns,
        setSubagents,
        busy,
        sessions,
        workspace,
        conversation,
        notifyChanged,
    };
}
