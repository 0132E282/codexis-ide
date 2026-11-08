import type { AgentCli, Step } from '@/lib/ide';
import type { Turn } from '@/components/shell/chat/turn';

/** A tool call the CLI started (`parent` is set when a sub-agent made it). */
export type ToolCallEvent = {
    id: string;
    name: string;
    description: string;
    input: string;
    before?: string;
    after?: string;
    parent?: string;
};

/** The result of a tool call. */
export type ToolResultEvent = {
    id: string;
    output: string;
    error: boolean;
    /** Pictures the tool returned, as data URLs. */
    images?: string[];
    parent?: string;
};

/** Words a sub-agent said. */
export type SubtextEvent = { parent: string; text: string };

/** A sub-agent that started. */
export type SubagentEvent = { id: string; label: string };

/** Context usage of the last turn, as the backend sends it (`Event::Context`, camelCase). `window` and `percent` are null when the window of the model is unknown. */
export type ContextUsage = {
    used: number;
    window: number | null;
    percent: number | null;
    input: number;
    cacheRead: number;
    cacheCreation: number;
    output: number;
    model: string;
};

/** The payload of an agent event that carries JSON; null when it is malformed (such an event is not shown). */
export function parsePayload<Payload>(payload: string): Payload | null {
    try {
        return JSON.parse(payload) as Payload;
    } catch {
        return null;
    }
}

/** All waiting messages as one prompt, in order, a blank line apart; the AI is the one chosen last. Null when nothing waits. */
export function mergeWaiting(
    waiting: { prompt: string; cli: AgentCli }[],
): { prompt: string; cli: AgentCli } | null {
    if (waiting.length === 0) {
        return null;
    }

    return {
        prompt: waiting.map((item) => item.prompt).join('\n\n'),
        cli: waiting[waiting.length - 1].cli,
    };
}

/** In a relayed turn another AI speaks from now on: its steps follow a label with its name. */
export function withSpeaker(turn: Turn, cli: AgentCli): Turn {
    return {
        ...turn,
        steps: [...(turn.steps ?? []), { kind: 'speaker', cli }],
    };
}

/** A whole piece of the answer: starts a new text step. */
export function withText(turn: Turn, payload: string): Turn {
    return {
        ...turn,
        answer: turn.answer ? `${turn.answer}\n\n${payload}` : payload,
        steps: [...(turn.steps ?? []), { kind: 'text', text: payload }],
    };
}

/** A piece of the answer still being written: appended as it is, to the last step when that is text. */
export function withDelta(turn: Turn, payload: string): Turn {
    const steps = [...(turn.steps ?? [])];
    const last = steps[steps.length - 1];

    if (last?.kind === 'text') {
        steps[steps.length - 1] = {
            kind: 'text',
            text: last.text + payload,
        };
    } else {
        steps.push({ kind: 'text', text: payload });
    }

    return {
        ...turn,
        answer: turn.answer + payload,
        steps,
    };
}

/** A tool call joins the steps of the turn, or of the sub-agent that made it. */
export function withToolCall(turn: Turn, call: ToolCallEvent): Turn {
    const step: Step = {
        kind: 'tool',
        id: call.id,
        name: call.name,
        description: call.description,
        input: call.input,
        change:
            call.before !== undefined && call.after !== undefined
                ? { before: call.before, after: call.after }
                : undefined,
        output: null,
        status: 'running',
    };
    // * The CLI can send the same call again: it is shown once.
    const list =
        call.parent === undefined ? turn.steps : turn.sub?.[call.parent];

    if (list?.some((item) => item.kind === 'tool' && item.id === call.id)) {
        return turn;
    }

    return call.parent === undefined
        ? {
              ...turn,
              // * Words before a tool call and the answer after it must not run together.
              answer: turn.answer ? `${turn.answer}\n\n` : '',
              steps: [...(turn.steps ?? []), step],
          }
        : {
              ...turn,
              sub: {
                  ...turn.sub,
                  [call.parent]: [...(turn.sub?.[call.parent] ?? []), step],
              },
          };
}

/** The tool call it answers is marked as done (or failed), with its output. */
export function withToolResult(turn: Turn, result: ToolResultEvent): Turn {
    const finish = (list: Step[] | undefined): Step[] | undefined =>
        list?.map((step) =>
            step.kind === 'tool' && step.id === result.id
                ? {
                      ...step,
                      output: result.output,
                      images: result.images,
                      status: result.error
                          ? ('error' as const)
                          : ('ok' as const),
                  }
                : step,
        );

    return result.parent === undefined
        ? { ...turn, steps: finish(turn.steps) }
        : {
              ...turn,
              sub: {
                  ...turn.sub,
                  [result.parent]: finish(turn.sub?.[result.parent]) ?? [],
              },
          };
}

/** Words of a sub-agent join its own steps. */
export function withSubtext(turn: Turn, spoken: SubtextEvent): Turn {
    return {
        ...turn,
        sub: {
            ...turn.sub,
            [spoken.parent]: [
                ...(turn.sub?.[spoken.parent] ?? []),
                { kind: 'text', text: spoken.text },
            ],
        },
    };
}
