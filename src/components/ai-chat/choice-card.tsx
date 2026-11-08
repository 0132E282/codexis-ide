import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
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
    /** The pending card is shown in a popup above the message box: in the thread it is left out until it is answered. */
    inPopup?: boolean;
};

/** * One-question choice card: numbered options, a free-text "Something else" row, "Skip" and a close button (no "n of m" pager: the choices format carries a single question). Read-only once answered or superseded. */
export function ChoiceCard({
    choices,
    interactive,
    answer,
    onChoose,
    inPopup = false,
    floating = false,
    onClose,
}: {
    choices: Choices;
    /** Laid out as the popup anchored above the message box (the caller positions it). */
    floating?: boolean;
    /** Called when the card is closed or skipped. */
    onClose?: () => void;
} & ChoiceHandlers) {
    const questionId = useId();
    const group = useRef<HTMLDivElement>(null);
    const [other, setOther] = useState('');
    const [dismissed, setDismissed] = useState(false);

    // * The popup takes the keyboard focus when it opens, unless the person is in the middle of typing a message.
    useEffect(() => {
        if (!floating) {
            return;
        }

        const active = document.activeElement;
        const isTyping =
            (active instanceof HTMLTextAreaElement ||
                active instanceof HTMLInputElement) &&
            active.value !== '';

        if (!isTyping) {
            group.current?.focus();
        }
    }, [floating]);

    // * Pending in the thread: the popup above the message box shows it instead.
    if (dismissed || (inPopup && interactive && !floating)) {
        return null;
    }

    const dismiss = () => {
        setDismissed(true);
        onClose?.();
    };

    const choose = (text: string) => {
        if (interactive && text.trim() !== '') {
            onChoose(text.trim());
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (floating && event.key === 'Escape') {
            event.stopPropagation();
            dismiss();

            return;
        }

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
            ref={group}
            role="group"
            aria-labelledby={questionId}
            tabIndex={floating ? -1 : undefined}
            onKeyDown={handleKeyDown}
            className={cn(
                'overflow-hidden rounded-xl border border-ring bg-background px-4 py-3',
                floating
                    ? 'max-h-[50vh] overflow-y-auto shadow-xl outline-none'
                    : 'my-3',
            )}
        >
            <div className="flex items-start justify-between gap-3 pb-3">
                <p id={questionId} className="text-sm">
                    {choices.question}
                </p>
                {interactive && (
                    <button
                        type="button"
                        aria-label={t('choice_card.close')}
                        onClick={dismiss}
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
                                matched &&
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
                        onClick={dismiss}
                    >
                        {t('choice_card.skip')}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
