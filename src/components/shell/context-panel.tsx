import { Button } from '@/components/ui/button';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from '@/components/ui/hover-card';
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

/** * One line of the breakdown: what it counts and how many tokens. */
function UsageRow({ label, tokens }: { label: string; tokens: number }) {
    return (
        <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{formatTokens(tokens)}</span>
        </div>
    );
}

/** * Button holding the ring and the share of the model's context the chat has used; hovering it shows the breakdown, and it opens the session rail through `onClick`. */
export function ContextPanel({ usage, className, onClick }: ContextPanelProps) {
    const percent = usage?.percent ?? null;

    return (
        <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn('gap-1.5 text-muted-foreground', className)}
                    aria-label={t('context_panel.trigger')}
                    data-rail-toggle=""
                    onClick={onClick}
                >
                    <ContextRing percent={percent} />
                    {percent !== null && (
                        <span className="text-xs tabular-nums">
                            {Math.round(percent)}%
                        </span>
                    )}
                </Button>
            </HoverCardTrigger>
            <HoverCardContent align="end" className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                        {t('context_panel.title')}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                        {usage === null
                            ? t('context_panel.no_usage')
                            : usage.window === null
                              ? formatTokens(usage.used)
                              : `${formatTokens(usage.used)} / ${formatTokens(usage.window)}`}
                    </span>
                </div>
                <div
                    role="progressbar"
                    aria-label={t('context_panel.trigger')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent === null ? undefined : percent}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                >
                    <div
                        className="h-full rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: `${Math.min(percent ?? 0, 100)}%` }}
                    />
                </div>
                {usage !== null && (
                    <div className="space-y-1.5">
                        <UsageRow
                            label={t('context_panel.input')}
                            tokens={usage.input}
                        />
                        <UsageRow
                            label={t('context_panel.output')}
                            tokens={usage.output}
                        />
                        {usage.cacheRead > 0 && (
                            <UsageRow
                                label={t('context_panel.cache_read')}
                                tokens={usage.cacheRead}
                            />
                        )}
                        {usage.cacheCreation > 0 && (
                            <UsageRow
                                label={t('context_panel.cache_creation')}
                                tokens={usage.cacheCreation}
                            />
                        )}
                    </div>
                )}
            </HoverCardContent>
        </HoverCard>
    );
}
