import type { AgentCli, ChatHistory, Step } from '@/lib/ide';

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

/** The turns of a saved conversation, ready to show (nothing is running, nothing is typed out again). */
export function restoreTurns(history: ChatHistory): Turn[] {
    return history.turns.map((turn) => ({
        ...turn,
        // * Turns saved by an older version hold the tool calls as `> ⚙ {json}` lines; they are not part of the answer.
        answer: turn.answer
            .replace(OLD_TOOL_LINES, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
        running: false,
        restored: true,
    }));
}
