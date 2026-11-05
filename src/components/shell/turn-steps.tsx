import { Asterisk, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChoiceHandlers } from '@/components/ai-chat/choice-card';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { UnifiedDiff } from '@/components/ai-chat/unified-diff';
import type { Step } from '@/lib/ide';
import { cn } from '@/lib/utils';

type ToolStep = Extract<Step, { kind: 'tool' }>;

const DOT_CLASS = {
    text: 'bg-muted-foreground/60',
    running: 'animate-pulse bg-amber-400 motion-reduce:animate-none',
    ok: 'bg-emerald-500',
    error: 'bg-[#d9573f]',
} as const;

const SHELL_TOKEN = /("[^"]*"|'[^']*'|\s+|&&|\|\||[|;<>&]+|[^\s|;<>&"']+)/g;

/** A shell command with its program, flags and quoted strings in their own colours, so a long line is easier to read. */
function ShellCommand({ command }: { command: string }) {
    let expectProgram = true;

    return command.split(SHELL_TOKEN).map((token, index): ReactNode => {
        if (token === '' || /^\s+$/.test(token)) {
            return token;
        }

        if (/^(&&|\|\||[|;<>&]+)$/.test(token)) {
            expectProgram = !/^[<>]+$/.test(token);

            return (
                <span key={index} className="text-muted-foreground">
                    {token}
                </span>
            );
        }

        const color = expectProgram
            ? 'font-semibold text-sky-400'
            : /^["']/.test(token)
              ? 'text-emerald-400'
              : token.startsWith('-')
                ? 'text-amber-400'
                : '';

        expectProgram = false;

        return (
            <span key={index} className={color}>
                {token}
            </span>
        );
    });
}

/** A labelled row of a tool card (`IN` / `OUT`); a long value scrolls instead of growing the card. */
function ToolRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex gap-3 px-3 py-2 [&:not(:first-child)]:border-t">
            <span className="w-8 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
                {label}
            </span>
            <pre className="max-h-40 min-w-0 flex-1 overflow-auto font-mono text-xs/5 break-all whitespace-pre-wrap">
                {children}
            </pre>
        </div>
    );
}

/** One tool call: a single line (name and what it works on) that opens into its command, result or diff. */
function ToolView({ step }: { step: ToolStep }) {
    // * A failed call opens by itself: that is the one worth reading.
    const [open, setOpen] = useState(step.status === 'error');
    const summary = step.description || step.input;
    const hasDetail =
        step.change !== undefined ||
        step.input !== '' ||
        (step.output !== null && step.output !== '');

    return (
        <div className="min-w-0">
            <button
                type="button"
                aria-expanded={open}
                disabled={!hasDetail}
                onClick={() => setOpen((current) => !current)}
                className="flex w-full min-w-0 items-baseline gap-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
                <ChevronRight
                    aria-hidden="true"
                    className={cn(
                        'size-3.5 shrink-0 translate-y-0.5 text-muted-foreground transition-transform',
                        open && 'rotate-90',
                        !hasDetail && 'invisible',
                    )}
                />
                <span className="shrink-0 font-semibold">{step.name}</span>
                <span className="truncate text-muted-foreground">
                    {summary}
                </span>
            </button>
            {open && hasDetail && (
                <div className="mt-2 overflow-hidden rounded-lg border bg-card">
                    {step.change !== undefined ? (
                        <div className="max-h-72 overflow-auto">
                            {step.input !== '' && (
                                <p className="border-b px-3 py-1.5 font-mono text-xs text-muted-foreground">
                                    {step.input}
                                </p>
                            )}
                            <UnifiedDiff
                                before={step.change.before}
                                after={step.change.after}
                            />
                        </div>
                    ) : (
                        step.input !== '' && (
                            <ToolRow label="IN">
                                {step.name === 'Bash' ? (
                                    <ShellCommand command={step.input} />
                                ) : (
                                    step.input
                                )}
                            </ToolRow>
                        )
                    )}
                    {step.output !== null && step.output !== '' && (
                        <ToolRow label="OUT">{step.output}</ToolRow>
                    )}
                </div>
            )}
        </div>
    );
}

/** The turn as a timeline: the AI's words and every tool call as one line that opens into the details, a dot per step coloured by how it went. */
export const TurnSteps = memo(function TurnSteps({
    steps,
    running,
    choices,
}: {
    steps: Step[];
    running: boolean;
    choices: ChoiceHandlers;
}) {
    return (
        <ol className="relative min-w-0 space-y-3 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
            {steps.map((step, index) => {
                const dot = step.kind === 'text' ? 'text' : step.status;

                return (
                    <li key={index} className="relative min-w-0">
                        <span
                            aria-hidden="true"
                            className={cn(
                                'absolute top-2 -left-6 size-[11px] rounded-full ring-4 ring-background',
                                DOT_CLASS[dot],
                            )}
                        />
                        {step.kind === 'text' ? (
                            <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                                <MarkdownContent
                                    content={step.text}
                                    choices={choices}
                                />
                            </div>
                        ) : (
                            <ToolView step={step} />
                        )}
                    </li>
                );
            })}
            {running && (
                <li
                    role="status"
                    className="flex items-center gap-2 text-[#d97757]"
                >
                    <Asterisk
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none"
                    />
                    Đang làm việc…
                </li>
            )}
        </ol>
    );
});
