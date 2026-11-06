import type { ToolEntry } from '@/lib/ide-tools';
import { t } from '@/lib/i18n';

/** The skills or sub-agents that match what is typed; the active one is picked with Enter or Tab. */
export function SuggestionList({
    prefix,
    suggestions,
    activeSuggestion,
    onPick,
}: {
    prefix: string;
    suggestions: ToolEntry[];
    activeSuggestion: number;
    onPick: (entry: ToolEntry) => void;
}) {
    return (
        <ul
            role="listbox"
            aria-label={t('common.command')}
            className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
            {suggestions.map((skill, index) => (
                <li
                    key={`${skill.scope}-${skill.name}`}
                    role="option"
                    aria-selected={index === activeSuggestion}
                >
                    <button
                        type="button"
                        onMouseDown={(event) => {
                            event.preventDefault();
                            onPick(skill);
                        }}
                        className={`flex w-full flex-col rounded-sm px-2 py-1.5 text-left ${index === activeSuggestion ? 'bg-accent' : 'hover:bg-accent/60'}`}
                    >
                        <span className="font-medium">
                            {prefix}
                            {prefix === '@' ? 'agent-' : ''}
                            {skill.name}
                        </span>
                        {skill.description !== '' && (
                            <span className="truncate text-xs text-muted-foreground">
                                {skill.description}
                            </span>
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
}
