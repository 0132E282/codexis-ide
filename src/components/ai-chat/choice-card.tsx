import { ArrowRight, Check, Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Choices } from '@/lib/choices-parser';
import { cn } from '@/lib/utils';

/** * Wiring from the chat thread: only the last answer is interactive, a pick is sent as the next user message. */
export type ChoiceHandlers = {
    interactive: boolean;
    /** The user message that followed this card, when there is one (marks the picked option). */
    answer: string | null;
    onChoose: (text: string) => void;
};

/** * One-question choice card: numbered options, a free-text "Khác…" row and "Bỏ qua". Read-only once answered or superseded. */
export function ChoiceCard({
    choices,
    interactive,
    answer,
    onChoose,
}: { choices: Choices } & ChoiceHandlers) {
    const questionId = useId();
    const [other, setOther] = useState('');
    const [dismissed, setDismissed] = useState(false);

    if (dismissed) {
        return null;
    }

    const choose = (text: string) => {
        if (interactive && text.trim() !== '') {
            onChoose(text.trim());
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // * Number shortcuts must not hijack typing in the "Khác…" field.
        if (
            !interactive ||
            event.target instanceof HTMLInputElement ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
        ) {
            return;
        }

        const option = choices.options[Number(event.key) - 1];

        if (option) {
            event.preventDefault();
            choose(option.label);
        }
    };

    const matched = choices.options.some((option) => option.label === answer);

    return (
        <div
            role="group"
            aria-labelledby={questionId}
            onKeyDown={handleKeyDown}
            className="my-3 overflow-hidden rounded-lg border border-border"
        >
            <p id={questionId} className="px-4 py-3 text-sm font-medium">
                {choices.question}
            </p>
            {choices.options.map((option, index) => {
                const picked = !interactive && option.label === answer;

                return (
                    <button
                        key={index}
                        type="button"
                        disabled={!interactive}
                        onClick={() => choose(option.label)}
                        className={cn(
                            'group flex w-full items-start gap-3 border-t border-border px-4 py-2.5 text-left transition-colors focus-visible:outline-none',
                            interactive
                                ? 'hover:bg-muted focus-visible:bg-muted'
                                : 'cursor-default',
                            picked && 'bg-muted',
                            !interactive &&
                                answer !== null &&
                                !picked &&
                                'opacity-50',
                        )}
                    >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground group-hover:bg-background group-focus-visible:bg-background">
                            {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">
                                {option.label}
                                {option.recommended && (
                                    <span className="ml-1.5 font-normal text-muted-foreground">
                                        (Khuyến nghị)
                                    </span>
                                )}
                            </span>
                            {option.description && (
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                    {option.description}
                                </span>
                            )}
                        </span>
                        {picked ? (
                            <Check
                                aria-hidden="true"
                                className="mt-0.5 size-4 shrink-0"
                            />
                        ) : (
                            interactive && (
                                <ArrowRight
                                    aria-hidden="true"
                                    className="mt-0.5 size-4 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                                />
                            )
                        )}
                    </button>
                );
            })}
            {interactive ? (
                <div className="flex items-center gap-2 border-t border-border px-4 py-2">
                    <Pencil
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <Input
                        value={other}
                        maxLength={2000}
                        placeholder="Khác…"
                        aria-label="Câu trả lời khác"
                        onChange={(event) => setOther(event.target.value)}
                        onKeyDown={(event) => {
                            if (
                                event.key === 'Enter' &&
                                !event.nativeEvent.isComposing
                            ) {
                                event.preventDefault();
                                choose(other);
                            }
                        }}
                        className="h-8 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground"
                        onClick={() => setDismissed(true)}
                    >
                        Bỏ qua
                    </Button>
                </div>
            ) : (
                answer !== null &&
                !matched && (
                    <p className="flex items-center gap-2 border-t border-border px-4 py-2 text-sm">
                        <Check aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 break-words">{answer}</span>
                    </p>
                )
            )}
        </div>
    );
}
