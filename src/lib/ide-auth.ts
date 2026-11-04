import { invoke } from '@tauri-apps/api/core';

export type AuthProvider = 'claude' | 'codex' | 'github';

/** Sign-in state of one tool, read from the tool itself. */
export type AuthStatus = {
    provider: AuthProvider;
    installed: boolean;
    loggedIn: boolean;
    account: string | null;
    /** Label and value rows for the detail table; never tokens or keys. */
    details: { label: string; value: string }[];
};

/** One limit of the plan, as `/usage` of the CLI reports it. */
export type LimitUsage = {
    label: string;
    percent: number;
    resets: string | null;
};

export const ideAuth = {
    /** Sign-in state of every tool; the AI CLIs are read under their active account. */
    status: () => invoke<AuthStatus[]>('auth_status'),
    /** Sign-in state of an AI CLI under one of its accounts. */
    statusProfile: (provider: AuthProvider, profile: number) =>
        invoke<AuthStatus>('auth_status_profile', { provider, profile }),
    /** Plan limits of a Claude account from the CLI's own `/usage`; null when unreadable. Slow: not for polling. */
    claudeUsage: (profile: number) =>
        invoke<LimitUsage[] | null>('claude_usage_profile', { profile }),
    /** Starts the tool's own login (opens the browser); GitHub resolves with the one-time code to type there. */
    login: (provider: AuthProvider, profile?: number) =>
        invoke<string | null>('auth_login', { provider, profile }),
    /** Signs the tool out with its own logout command. */
    logout: (provider: AuthProvider, profile?: number) =>
        invoke<void>('auth_logout', { provider, profile }),
};
