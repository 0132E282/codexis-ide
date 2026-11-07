import { useSyncExternalStore } from 'react';

const VOICE_REPLY_KEY = 'codexis.voiceReply';
// * An earlier version kept the choice here: still read when the new key was never written.
const LEGACY_KEY = 'codexis.autoRead';
const listeners = new Set<() => void>();

const read = (key: string): string | null => {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};
// * The browser storage may be blocked: the choice then lasts until the page is closed.
const memory: Record<string, string> = {};
const get = (key: string): string | null => memory[key] ?? read(key);
const put = (key: string, value: string) => {
    memory[key] = value;

    try {
        window.localStorage.setItem(key, value);
    } catch {
        // * Kept in memory only.
    }

    listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
};

/** `on`/`off` is saved at once, so the choice holds after the app is reopened. */
export const setVoiceReply = (on: boolean) =>
    put(VOICE_REPLY_KEY, on ? 'on' : 'off');
const isVoiceReplyOn = () => {
    const saved = get(VOICE_REPLY_KEY);

    return saved === null ? get(LEGACY_KEY) === 'true' : saved === 'on';
};

/** Voice replies: answers are read aloud as they finish and the voice effect is shown; one choice for every chat, off by default. */
export function useVoiceReply(): boolean {
    return useSyncExternalStore(subscribe, isVoiceReplyOn);
}

// * The chat that was last used (focused or clicked): in the chat grid only that one reads its answers aloud.
let activeChat: string | null = null;

export const markChatActive = (id: string) => {
    activeChat = id;
};
/** True when no chat was used yet (a lone chat reads) or this is the last used one. */
export const isChatActive = (id: string) =>
    activeChat === null || activeChat === id;
