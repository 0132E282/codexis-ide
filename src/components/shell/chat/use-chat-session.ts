import { useEffect, useRef, useState } from 'react';
import type { PlanData } from '@/components/shell/plan-pane';
import { parsePayload } from '@/components/shell/chat/turn-events';
import type { ContextUsage } from '@/components/shell/chat/turn-events';
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
    onPlan,
    onRestoreCli,
    onReset,
}: {
    root: string;
    newChat: number;
    openConversation: { id: number; n: number } | null;
    onConversation: (id: number) => void;
    onChanged: () => void;
    onSubagents: (subagents: Subagent[]) => void;
    /** The plan of the open conversation changed (null: it has none). */
    onPlan: (plan: PlanData | null) => void;
    /** The AI of the last turn of a loaded conversation is the one picked again. */
    onRestoreCli: (cli: AgentCli) => void;
    /** Another conversation is shown: what was typed for the old one (attachments) goes. */
    onReset: () => void;
}) {
    const [subagents, setSubagents] = useState<Subagent[]>([]);
    const [turns, setTurns] = useState<Turn[]>([]);
    // * Context usage of the open conversation; null until a turn reports it (it is not saved, so another conversation starts empty).
    const [context, setContext] = useState<ContextUsage | null>(null);
    // * The plan the AI wrote in the open conversation: loaded from the saved one, then replaced by each new plan of a turn.
    const [plan, setPlan] = useState<PlanData | null>(null);
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

    useEffect(() => {
        onPlan(plan);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plan]);

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

        if (replace) {
            setContext(null);
            setPlan(null);
        }

        // * The plan was written by Claude (its `ExitPlanMode`); a plan that arrived while this loaded is newer.
        const claudeSession = history.sessions.claude;

        if (claudeSession !== undefined) {
            void ide
                .planLoad(claudeSession, root)
                .then((json) => {
                    const saved =
                        json === null ? null : parsePayload<PlanData>(json);

                    if (saved !== null) {
                        setPlan((current) => current ?? saved);
                    }
                })
                .catch(() => undefined);
        }

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
            openConversation.id === conversation.current ||
            busy
        ) {
            return;
        }

        void ide
            .chatLoad(openConversation.id, root)
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
                setContext(null);
                setPlan(null);
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
        context,
        setContext,
        setPlan,
        setSubagents,
        busy,
        sessions,
        workspace,
        conversation,
        notifyChanged,
    };
}
