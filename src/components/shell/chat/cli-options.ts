import {
    AntigravityIcon,
    ClaudeIcon,
    CodexIcon,
    OllamaIcon,
    OpenClawIcon,
} from '@/icons';
import type { AgentCli } from '@/lib/ide';

// * Just the brand icon, with no tile behind it.
export const CLI_ICONS = {
    claude: ClaudeIcon,
    codex: CodexIcon,
    ollama: OllamaIcon,
    antigravity: AntigravityIcon,
    openclaw: OpenClawIcon,
};

export const CLIS: { value: AgentCli; label: string; vendor: string }[] = [
    { value: 'claude', label: 'Claude', vendor: 'anthropic' },
    { value: 'codex', label: 'ChatGPT', vendor: 'openai' },
    { value: 'ollama', label: 'Ollama', vendor: 'local' },
    { value: 'antigravity', label: 'Antigravity', vendor: 'google' },
    { value: 'openclaw', label: 'OpenClaw', vendor: 'openclaw' },
];

// * Fixed lists: they name aliases / models each CLI accepts for `--model` / `-m`; none picked (null) runs the CLI's own default and the button shows the CLI's name.
export const MODELS: Record<
    AgentCli,
    { value: string | null; label: string }[]
> = {
    claude: [
        { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
        { value: 'claude-opus-5-5', label: 'Opus 5.5' },
        { value: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    ],
    codex: [
        { value: 'gpt-5', label: 'GPT-5' },
        { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
    ],
    // * No fixed list: only models installed locally and reported by `ollama ls` are offered.
    ollama: [],
    // * No fixed list: the models are the ones `agy models` lists, and only when it is signed in (empty = not offered).
    antigravity: [],
    // * One entry, the agent's own default: the menu lists only the AIs that have a model to pick.
    openclaw: [{ value: null, label: 'OpenClaw' }],
};

type ModeOption = {
    value: string;
    label: string;
    hint: string;
    recommended?: boolean;
    /** Needs the person to confirm before it is used (accepts every permission). */
    dangerous?: boolean;
};

// * Each CLI has different execution controls; a missing flag keeps its own default.
export const MODES: Record<AgentCli, ModeOption[]> = {
    claude: [
        {
            value: 'auto',
            label: 'Auto',
            hint: 'cli_options.auto_approve_safe_actions',
            recommended: true,
        },
        {
            value: 'manual',
            label: 'cli_options.ask_each_time',
            hint: 'cli_options.ask_before_every_action',
        },
        {
            value: 'acceptEdits',
            label: 'cli_options.auto_edit_files',
            hint: 'cli_options.automatically_accept_every_file',
        },
        { value: 'plan', label: 'Plan', hint: 'cli_options.plan_only_do_not' },
        {
            value: 'bypassPermissions',
            label: 'cli_options.bypass_permissions',
            hint: 'cli_options.accepts_all_permissions',
            dangerous: true,
        },
    ],
    codex: [
        {
            value: 'default',
            label: 'cli_options.cli_default',
            hint: 'cli_options.cli_default_hint',
        },
        {
            value: 'read-only',
            label: 'cli_options.read_only',
            hint: 'cli_options.codex_read_only_hint',
        },
        {
            value: 'workspace-write',
            label: 'cli_options.workspace_write',
            hint: 'cli_options.codex_workspace_write_hint',
        },
        {
            value: 'approve-for-me',
            label: 'cli_options.approve_for_me',
            hint: 'cli_options.codex_approve_for_me_hint',
        },
        {
            value: 'bypassPermissions',
            label: 'cli_options.bypass_permissions',
            hint: 'cli_options.codex_bypass_hint',
            dangerous: true,
        },
    ],
    ollama: [],
    openclaw: [],
    antigravity: [
        {
            value: 'default',
            label: 'cli_options.cli_default',
            hint: 'cli_options.cli_default_hint',
        },
        {
            value: 'auto',
            label: 'Auto',
            hint: 'cli_options.antigravity_auto_hint',
        },
        {
            value: 'accept-edits',
            label: 'cli_options.auto_edit_files',
            hint: 'cli_options.antigravity_accept_edits_hint',
        },
        {
            value: 'plan',
            label: 'Plan',
            hint: 'cli_options.antigravity_plan_hint',
        },
        {
            value: 'bypassPermissions',
            label: 'cli_options.bypass_permissions',
            hint: 'cli_options.accepts_all_permissions',
            dangerous: true,
        },
    ],
};

export const DEFAULT_MODES: Record<AgentCli, string> = {
    claude: 'auto',
    codex: 'default',
    ollama: 'default',
    antigravity: 'default',
    openclaw: 'default',
};
