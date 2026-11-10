import { invoke } from '@tauri-apps/api/core';

export type ProfileCli =
    'claude' | 'codex' | 'gemini' | 'antigravity' | 'github';

/** One account of an AI CLI. Id 0 is the CLI's own login; the others are kept by Codexis. */
export type Profile = {
    id: number;
    cli: ProfileCli;
    name: string;
    /** The account chats and statistics of this CLI use. */
    active: boolean;
};

export const ideProfiles = {
    list: () => invoke<Profile[]>('profiles_list'),
    add: (cli: ProfileCli, name: string) =>
        invoke<Profile[]>('profile_add', { cli, name }),
    remove: (cli: ProfileCli, id: number) =>
        invoke<Profile[]>('profile_remove', { cli, id }),
    rename: (cli: ProfileCli, id: number, name: string) =>
        invoke<Profile[]>('profile_rename', { cli, id, name }),
    select: (cli: ProfileCli, id: number) =>
        invoke<Profile[]>('profile_select', { cli, id }),
};
