import { translateError } from '@/lib/i18n';
import { invoke } from '@/lib/invoke';

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

/** Public profile of the signed-in GitHub account, read by the backend through `gh`. */
export type GithubProfile = {
    login: string;
    /** Display name; empty when the account has none. */
    name: string;
    /** Public email; empty when kept private. */
    email: string;
    /** Avatar as an image data URL; empty when it could not be downloaded. */
    avatar: string;
};

/** One limit of the plan, as `/usage` of the CLI reports it. */
export type LimitUsage = {
    label: string;
    percent: number;
    resets: string | null;
};

/** The detail labels come from the backend as keys. */
function translated(status: AuthStatus): AuthStatus {
    return {
        ...status,
        details: status.details.map((row) => ({
            ...row,
            label: translateError(row.label),
        })),
    };
}

export const ideAuth = {
    /** Sign-in state of every tool; the AI CLIs are read under their active account. */
    status: () =>
        invoke<AuthStatus[]>('auth_status').then((all) => all.map(translated)),
    /** Sign-in state of an AI CLI under one of its accounts. */
    statusProfile: (provider: AuthProvider, profile: number) =>
        invoke<AuthStatus>('auth_status_profile', { provider, profile }).then(
            translated,
        ),
    /** Plan limits of a Claude account from the CLI's own `/usage`; null when unreadable. Slow: not for polling. */
    claudeUsage: (profile: number) =>
        invoke<LimitUsage[] | null>('claude_usage_profile', { profile }),
    /** Profile of the GitHub account `gh` is signed in with (login, name, email, avatar). */
    githubProfile: () => invoke<GithubProfile>('github_profile'),
    /** Starts the tool's own login (opens the browser); GitHub resolves with the one-time code to type there. */
    login: (provider: AuthProvider, profile?: number) =>
        invoke<string | null>('auth_login', { provider, profile }),
    /** Signs the tool out with its own logout command. */
    logout: (provider: AuthProvider, profile?: number) =>
        invoke<void>('auth_logout', { provider, profile }),
};
