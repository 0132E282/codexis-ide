import { invoke } from '@tauri-apps/api/core';
import type { AgentCli } from '@/lib/ide';

/** Usage of one CLI, as counted by the backend. */
export type CliUsage = {
    cli: AgentCli;
    turns24h: number;
    turns7d: number;
    /** Unix seconds of the last turn. */
    lastUsedAt: number | null;
    models: string[];
    tokens24h: number;
    tokens7d: number;
    /** The last limit error is newer than the last successful turn. */
    limitReached: boolean;
    /** Unix seconds of the last limit error. */
    limitAt: number | null;
};
export type UsageStats = { clis: CliUsage[] };

export const ideUsage = {
    /** Records a finished chat turn: sizes only, never the text. Resolves to whether the turn ended on a limit error. */
    record: (turn: {
        cli: AgentCli;
        promptCharacters: number;
        answerCharacters: number;
        model: string | null;
        error: string | null;
    }) => invoke<boolean>('usage_record', turn),
    stats: () => invoke<UsageStats>('usage_stats'),
    /** Usage of one account of a CLI, active or not. */
    statsProfile: (cli: AgentCli, profile: number) =>
        invoke<CliUsage>('usage_stats_profile', { cli, profile }),
};
