import { Button } from '@/components/ui/button';
import type { ContextUsage } from '@/components/shell/chat/turn-events';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type { ContextUsage };

type ContextPanelProps = {
    /** * Null until a turn reports usage (or after the model changed). */
    usage: ContextUsage | null;
    className?: string;
    onClick?: () => void;
};

/** * Compact count: 203900 → `203.9k`, 400000 → `400k`. Only formats; the backend does the maths. */
export function formatTokens(count: number): string {
    if (count < 1000) {
        return String(count);
    }

    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

/** * Ring that fills with the share of the context window used (empty when unknown), like the one in Claude. */
function ContextRing({ percent }: { percent: number | null }) {
    const radius = 7;
    const circumference = 2 * Math.PI * radius;
    const filled = percent === null ? 0 : Math.min(percent, 100) / 100;

    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="size-5 -rotate-90"
        >
            <circle
                cx="10"
                cy="10"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="opacity-40"
            />
            <circle
                cx="10"
                cy="10"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - filled)}
                className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
            />
        </svg>
    );
}

/** * Button holding the ring of how much of the model's context the chat has used; it opens the session rail through `onClick`. */
export function ContextPanel({ usage, className, onClick }: ContextPanelProps) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn('text-muted-foreground', className)}
            aria-label={t('context_panel.trigger')}
            title={t('context_panel.trigger')}
            data-rail-toggle=""
            onClick={onClick}
        >
            <ContextRing percent={usage?.percent ?? null} />
        </Button>
    );
}
