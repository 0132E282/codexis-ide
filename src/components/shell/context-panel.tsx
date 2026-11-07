import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import type { ContextUsage } from '@/components/shell/chat/turn-events';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type { ContextUsage };

type ContextPanelProps = {
    /** * Null until a turn reports usage (or after the model changed). */
    usage: ContextUsage | null;
    /** * CLI in use (`claude` or `codex`), shown beside the model. */
    cli?: string;
    className?: string;
};

/** * Compact count: 203900 → `203.9k`, 400000 → `400k`. Only formats; the backend does the maths. */
export function formatTokens(count: number): string {
    if (count < 1000) {
        return String(count);
    }

    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="truncate font-medium tabular-nums">{value}</span>
        </div>
    );
}

function UsageBar({ percent }: { percent: number }) {
    const clamped = Math.min(100, Math.max(0, percent));

    return (
        <div
            role="progressbar"
            aria-label={t('context_panel.trigger')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamped)}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
            <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${clamped}%` }}
            />
        </div>
    );
}

function Details({ usage, cli }: { usage: ContextUsage; cli?: string }) {
    const { percent, window } = usage;
    const summary =
        window === null
            ? t('context_panel.used_only', { used: formatTokens(usage.used) })
            : t('context_panel.used_of', {
                  used: formatTokens(usage.used),
                  window: formatTokens(window),
              });

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium tabular-nums">{summary}</span>
                    {percent !== null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {t('context_panel.percent_used', {
                                percent: Math.round(percent),
                            })}
                        </span>
                    )}
                </div>
                {percent !== null && <UsageBar percent={percent} />}
            </div>
            <div className="flex flex-col gap-1.5">
                <Row
                    label={t('context_panel.input')}
                    value={formatTokens(usage.input)}
                />
                <Row
                    label={t('context_panel.cache_read')}
                    value={formatTokens(usage.cacheRead)}
                />
                <Row
                    label={t('context_panel.cache_creation')}
                    value={formatTokens(usage.cacheCreation)}
                />
                <Row
                    label={t('context_panel.output')}
                    value={formatTokens(usage.output)}
                />
            </div>
            <div className="flex flex-col gap-1.5 border-t pt-2">
                <Row label={t('context_panel.model')} value={usage.model} />
                {cli !== undefined && (
                    <Row label={t('context_panel.cli')} value={cli} />
                )}
            </div>
        </div>
    );
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

/** * Button that opens a popover with how much of the model's context the chat has used. Display only: it gets the numbers by props. */
export function ContextPanel({ usage, cli, className }: ContextPanelProps) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn('text-muted-foreground', className)}
                    aria-label={t('context_panel.trigger')}
                    title={t('context_panel.trigger')}
                >
                    <ContextRing percent={usage?.percent ?? null} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 max-w-[90vw]">
                <h3 className="mb-3 text-sm font-medium">
                    {t('context_panel.title')}
                </h3>
                {usage === null ? (
                    <p className="text-xs text-muted-foreground">
                        {t('context_panel.empty')}
                    </p>
                ) : (
                    <Details usage={usage} cli={cli} />
                )}
            </PopoverContent>
        </Popover>
    );
}
