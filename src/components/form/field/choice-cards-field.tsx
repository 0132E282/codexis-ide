import type { Control } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { cn } from '@/lib/utils';

export type ChoiceCardOption = {
    value: string;
    label: string;
    description?: string;
    /** * Small badge on the card, e.g. a type initial. */
    badge?: string;
    /** * Tailwind background class of the badge. */
    badgeClassName?: string;
};

export interface ChoiceCardsFieldProps {
    name: string;
    control?: Control;
    options?: ChoiceCardOption[];
    fieldProps?: Record<string, unknown>;
}

/** * Single choice shown as a row of selectable cards (radio semantics). */
export default function ChoiceCardsField({
    name,
    control,
    options = [],
    fieldProps,
}: ChoiceCardsFieldProps) {
    void fieldProps;

    const { field } = useController({ name, control });

    return (
        <div
            role="radiogroup"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
            {options.map((option) => {
                const selected = field.value === option.value;

                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => field.onChange(option.value)}
                        className={cn(
                            'flex items-center gap-3 rounded-md border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            selected
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-accent',
                        )}
                    >
                        {option.badge && (
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'flex size-7 shrink-0 items-center justify-center rounded text-xs font-semibold text-white',
                                    option.badgeClassName,
                                )}
                            >
                                {option.badge}
                            </span>
                        )}
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">
                                {option.label}
                            </span>
                            {option.description && (
                                <span className="block truncate text-xs text-muted-foreground">
                                    {option.description}
                                </span>
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
