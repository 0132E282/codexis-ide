import { ArrowLeft } from 'lucide-react';
import type { ChoiceHandlers } from '@/components/ai-chat/choice-card';
import type { Turn } from '@/components/shell/chat/turn';
import { TurnSteps } from '@/components/shell/turn-steps';
import { t } from '@/lib/i18n';

const READ_ONLY_CHOICES: ChoiceHandlers = {
    interactive: false,
    answer: null,
    onChoose: () => undefined,
};

/** What one sub-agent did and is doing: its words and tool calls, live, apart from the conversation of the main agent. */
export function SubagentView({
    id,
    turns,
    onBack,
}: {
    id: string;
    turns: Turn[];
    onBack: () => void;
}) {
    const owner = turns.find((turn) => turn.sub?.[id] !== undefined);
    const call = turns
        .flatMap((turn) => turn.steps ?? [])
        .find((step) => step.kind === 'tool' && step.id === id);
    const steps = owner?.sub?.[id] ?? [];
    const finished = call?.kind === 'tool' && call.status !== 'running';

    return (
        <div className="min-w-0 space-y-4">
            <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
                <ArrowLeft aria-hidden="true" className="size-4" />
                {t('subagent_view.back_to_the_conversation')}
            </button>
            {call?.kind === 'tool' && (
                <div className="rounded-lg border bg-card px-3 py-2">
                    <p className="font-semibold">
                        {call.name}{' '}
                        <span className="font-normal text-muted-foreground">
                            {call.description}
                        </span>
                    </p>
                    {call.input !== '' && (
                        <pre className="mt-1 max-h-32 overflow-auto font-mono text-xs/5 break-words whitespace-pre-wrap text-muted-foreground">
                            {call.input}
                        </pre>
                    )}
                </div>
            )}
            {steps.length > 0 ? (
                <TurnSteps
                    steps={steps}
                    running={!finished}
                    choices={READ_ONLY_CHOICES}
                />
            ) : (
                <p className="text-sm text-muted-foreground">
                    {finished
                        ? t('subagent_view.this_sub_agent_recorded')
                        : t('subagent_view.sub_agent_is_starting')}
                </p>
            )}
        </div>
    );
}
