import { ClaudeIcon, CodexIcon } from '@/icons';
import type { AgentCli } from '@/lib/ide';

// * Just the brand icon, with no tile behind it.
export const CLI_ICONS = { claude: ClaudeIcon, codex: CodexIcon };

export const CLIS: { value: AgentCli; label: string; vendor: string }[] = [
    { value: 'claude', label: 'Claude', vendor: 'anthropic' },
    { value: 'codex', label: 'ChatGPT', vendor: 'openai' },
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
};

// * Permission modes of the Claude CLI (`--permission-mode`); "auto" is the one the chat starts with.
export const MODES: { value: string; label: string; hint: string }[] = [
    { value: 'plan', label: 'Plan', hint: 'Chỉ lập kế hoạch, không sửa file' },
    { value: 'auto', label: 'Auto', hint: 'Tự duyệt các thao tác an toàn' },
    {
        value: 'acceptEdits',
        label: 'Tự sửa file',
        hint: 'Tự chấp nhận mọi lần sửa file',
    },
    { value: 'manual', label: 'Hỏi từng việc', hint: 'Hỏi trước mỗi thao tác' },
];
