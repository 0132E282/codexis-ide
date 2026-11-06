import type { AgentCli, ChangedFile, ChatHistory, Step } from '@/lib/ide';

/** A tool the AI asks to use, waiting for the person's answer. */
export type PermissionRequest = {
    id: string;
    tool: string;
    description: string | null;
    input: Record<string, unknown>;
};

export type Turn = {
    id: string;
    prompt: string;
    answer: string;
    error: string | null;
    running: boolean;
    cli: AgentCli;
    /** What the AI did, step by step, while this session ran; a turn loaded from the history has only its `answer`. */
    steps?: Step[];
    /** What each sub-agent of this turn did inside itself, by the id of the call that started it. */
    sub?: Record<string, Step[]>;
    /** Files this turn changed in the workspace (by git, so edits made through a shell count); only for a turn run in this session. */
    changed?: ChangedFile[];
    /** Questions of the AI ("Hỏi từng việc" mode) not answered yet; the first one is shown. */
    permissions?: PermissionRequest[];
    /** Loaded from the saved history: shown at once, not typed out. */
    restored?: boolean;
};

// * A tool call that an older version wrote into the saved answer.
const OLD_TOOL_LINES = /^> ⚙ .*$/gm;

const ATTACHMENT_LINE = /^@(\/.+)$/;
// * Pasted files are saved as `<8 hex digits>-<name>`: the digits are not part of the name the person sees.
const SAVED_PREFIX = /^[0-9a-f]{8}-/;

/** A message's `@/path` lines are attached files: they are shown as chips, the rest is the typed text. */
export function splitPrompt(prompt: string) {
    const files: { path: string; name: string }[] = [];
    const lines: string[] = [];

    for (const line of prompt.split('\n')) {
        const path = ATTACHMENT_LINE.exec(line)?.[1].trim();

        if (path === undefined) {
            lines.push(line);
        } else {
            const base = path.split('/').pop() ?? path;

            files.push({ path, name: base.replace(SAVED_PREFIX, '') });
        }
    }

    return { text: lines.join('\n').trim(), files };
}

/** The saved steps of a turn; undefined when there are none or they cannot be read. */
function parseSteps(saved: string | null | undefined): Step[] | undefined {
    if (saved === null || saved === undefined || saved === '') {
        return undefined;
    }

    try {
        const steps: unknown = JSON.parse(saved);

        return Array.isArray(steps) && steps.length > 0
            ? (steps as Step[])
            : undefined;
    } catch {
        return undefined;
    }
}

/** The turns of a saved conversation, ready to show (nothing is running, nothing is typed out again). */
export function restoreTurns(history: ChatHistory): Turn[] {
    return history.turns.map(({ steps, ...turn }) => ({
        ...turn,
        steps: parseSteps(steps),
        // * Turns saved by an older version hold the tool calls as `> ⚙ {json}` lines; they are not part of the answer.
        answer: turn.answer
            .replace(OLD_TOOL_LINES, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
        running: false,
        restored: true,
    }));
}
