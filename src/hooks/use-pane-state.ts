import { useCallback, useState } from 'react';
import type { Subagent } from '@/lib/ide';

/** A project whose chat and viewer are open: they stay mounted (hidden) while another project is shown, so tabs, unsaved edits and the chat survive the switch. */
export type Pane = { key: string; root: string; name: string };

/** What one pane remembers for itself. */
export type PaneState = {
    /** No file and no change list open: the chat takes the room the editor would have. */
    editorVisible: boolean;
    activeFile: string | null;
    /** Counter bumped by "Cuộc trò chuyện mới". */
    newChat: number;
    /** Conversation picked in the sidebar. */
    picked: number | null;
    /** Conversation shown. */
    conversation: number | null;
    /** Sub-agents the AI has started in the running turn. */
    subagents: Subagent[];
    /** The chat was closed by dragging the editor columns over it. */
    chatCollapsed: boolean;
    /** The sub-agent picked in the sidebar (`n` changes on every pick). */
    viewSubagent: string | null;
    /** A file double-clicked in the tree, for the chat to attach (`n` changes on every click). */
    attachFile: { path: string; n: number } | null;
};

export const FRESH: PaneState = {
    chatCollapsed: false,
    editorVisible: false,
    activeFile: null,
    newChat: 0,
    picked: null,
    conversation: null,
    subagents: [],
    viewSubagent: null,
    attachFile: null,
};

/** The per-pane state, keyed by pane; `patchPane` changes some fields of one pane and does nothing when nothing differs. */
export function usePaneState() {
    const [paneStates, setPaneStates] = useState<Record<string, PaneState>>({});

    const patchPane = useCallback(
        (key: string, change: Partial<PaneState>) =>
            setPaneStates((current) => {
                const before = current[key] ?? FRESH;
                const same = (Object.keys(change) as (keyof PaneState)[]).every(
                    (field) => before[field] === change[field],
                );

                return same
                    ? current
                    : { ...current, [key]: { ...before, ...change } };
            }),
        [],
    );

    return { paneStates, patchPane };
}
