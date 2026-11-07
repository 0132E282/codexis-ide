import { invoke } from '@/lib/invoke';

/** The Environment block: the folder (home written as `~`), the current git branch and whether the phone server runs. */
export type RailEnvironment = {
    folder: string;
    branch: string | null;
    remoteRunning: boolean;
};

/** A file the AI created or changed in the conversation (`path` is relative to the project). */
export type RailOutput = { path: string; tool: string };

export type RailPullRequest = { number: number; title: string; url: string };

/** How far the GitHub block got: `ok`, or why there is nothing to show. */
export type RailGithubStatus = 'ok' | 'no_cli' | 'signed_out' | 'no_remote';

export type RailGithub = {
    status: RailGithubStatus;
    account: string | null;
    repo: { owner: string; name: string; url: string } | null;
    branch: string | null;
    pullRequest: RailPullRequest | null;
};

/** The Usage block: sizes of the open conversation (null: none open) and of the last 24 hours over every project. Tokens are estimated from text length. */
export type RailUsage = {
    conversation: {
        turns: number;
        failedTurns: number;
        promptTokens: number;
        answerTokens: number;
        /** CLI of the newest turn (the model is not saved). */
        cli: string | null;
    } | null;
    today: { turns: number; tokens: number };
};

/** The Rust commands behind the session rail; every one only reads. */
export const ideSessionRail = {
    environment: (root: string) =>
        invoke<RailEnvironment>('session_rail_environment', { root }),
    outputs: async (root: string, conversation: number) =>
        (
            await invoke<{ files: RailOutput[] }>('session_rail_outputs', {
                root,
                conversation,
            })
        ).files,
    github: (root: string) =>
        invoke<RailGithub>('session_rail_github', { root }),
    usage: (root: string, conversation: number | null) =>
        invoke<RailUsage>('session_rail_usage', { root, conversation }),
    remoteStatus: () => invoke<boolean>('remote_status'),
};
