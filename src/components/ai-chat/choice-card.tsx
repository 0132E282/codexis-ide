import { Check, Pencil, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import Field from '@/components/form/field';
import { Button } from '@/components/ui/button';
import type { Choices } from '@/lib/choices-parser';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** * Wiring from the chat thread: only the last answer is interactive, a pick is sent as the next user message. */
export type ChoiceHandlers = {
    interactive: boolean;
    /** The user message that followed this card, when there is one (marks the picked option). */
    answer: string | null;
    onChoose: (text: string) => void;
};

/** * One-question choice card: numbered options, a free-text "Something else" row, "Skip" and a close button (no "n of m" pager: the choices format carries a single question). Read-only once answered or superseded. */
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
            className="my-3 overflow-hidden rounded-xl border border-ring bg-background px-4 py-3"
        >
            <div className="flex items-start justify-between gap-3 pb-3">
                <p id={questionId} className="text-sm">
                    {choices.question}
                </p>
                {interactive && (
                    <button
                        type="button"
                        aria-label={t('choice_card.close')}
                        onClick={() => setDismissed(true)}
                        className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
                    >
                        <X aria-hidden="true" className="size-4" />
                    </button>
                )}
            </div>
            {choices.options.map((option, index) => {
                const picked = !interactive && option.label === answer;

                return (
                    <button
                        key={index}
                        type="button"
                        disabled={!interactive}
                        onClick={() => choose(option.label)}
                        className={cn(
                            'group flex w-full items-center gap-3 border-t border-border py-2 text-left transition-colors focus-visible:outline-none',
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
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                            {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">
                                {option.label}
                                {option.recommended && (
                                    <span className="ml-1.5 font-normal text-muted-foreground">
                                        {t('choice_card.recommended')}
                                    </span>
                                )}
                            </span>
                            {option.description && (
                                <span className="block truncate text-xs text-muted-foreground">
                                    {option.description}
                                </span>
                            )}
                        </span>
                        {picked && (
                            <Check
                                aria-hidden="true"
                                className="size-4 shrink-0"
                            />
                        )}
                    </button>
                );
            })}
            {interactive ? (
                <div className="flex items-center gap-3 border-t border-border pt-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Pencil aria-hidden="true" className="size-3.5" />
                    </span>
                    <Field
                        name={`${questionId}-other`}
                        autoComplete="off"
                        value={other}
                        maxLength={2000}
                        placeholder={t('choice_card.other')}
                        aria-label={t('choice_card.other_answer')}
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
                        className="min-w-0 flex-1"
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7"
                        onClick={() => setDismissed(true)}
                    >
                        {t('choice_card.skip')}
                    </Button>
                </div>
            ) : (
                answer !== null &&
                !matched && (
                    <p className="flex items-center gap-2 border-t border-border pt-2 text-sm">
                        <Check aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 break-words">{answer}</span>
                    </p>
                )
            )}
        </div>
    );
}
