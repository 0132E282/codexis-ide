import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { AntigravityIcon, ClaudeIcon, CodexIcon, OllamaIcon } from '@/icons';
import { errorText } from '@/lib/ide';
import { ideAuth, type AuthProvider, type LimitUsage } from '@/lib/ide-auth';
import { ideProfiles } from '@/lib/ide-profiles';
import {
    formatRemaining,
    formatReset,
    limitColor,
    limitLabel,
} from '@/lib/limit-usage';
import { ideUsage, type CliUsage } from '@/lib/ide-usage';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const CLI_LABELS: Record<CliUsage['cli'], string> = {
    claude: 'Claude',
    codex: 'Codex',
    ollama: 'Ollama',
    antigravity: 'Antigravity',
};

/** Brand color of each CLI: its name and its usage bar. */
const CLI_COLORS: Record<CliUsage['cli'], { text: string; bar: string }> = {
    claude: {
        text: 'text-orange-600 dark:text-orange-400',
        bar: 'bg-orange-500',
    },
    codex: {
        text: 'text-emerald-600 dark:text-emerald-400',
        bar: 'bg-emerald-500',
    },
    ollama: {
        text: 'text-slate-600 dark:text-slate-300',
        bar: 'bg-slate-500',
    },
    antigravity: {
        text: 'text-blue-600 dark:text-blue-400',
        bar: 'bg-blue-500',
    },
};

const CLI_ICONS = {
    claude: ClaudeIcon,
    codex: CodexIcon,
    ollama: OllamaIcon,
    antigravity: AntigravityIcon,
};

const formatNumber = (value: number): string =>
    new Intl.NumberFormat('vi').format(value);

const formatShortTime = (seconds: number): string =>
    new Date(seconds * 1000).toLocaleString('vi', {
        dateStyle: 'short',
        timeStyle: 'short',
    });

/** One account of a CLI with its own numbers (a CLI with several accounts is shown once per account). */
type AccountRow = {
    key: string;
    id: number;
    label: string;
    usage: CliUsage;
    /** Plan limits (Claude only): undefined while they load, null when unreadable or not offered. */
    limits: LimitUsage[] | null | undefined;
};

/** AI statistics ("Thống kê AI"): turns, estimated tokens and models of each CLI, and which one stopped at its limit. */
export function UsageDialog({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [rows, setRows] = useState<AccountRow[] | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    // * Read again each time the dialog opens: the numbers change after every turn.
    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        const setLimitsOf = (key: string, limits: LimitUsage[] | null) =>
            setRows(
                (current) =>
                    current?.map((row) =>
                        row.key === key ? { ...row, limits } : row,
                    ) ?? null,
            );

        setFailure(null);
        ideProfiles
            .list()
            .then(async (all) => {
                const accounts = all.filter(
                    (profile) =>
                        profile.cli === 'claude' ||
                        profile.cli === 'codex' ||
                        profile.cli === 'antigravity',
                );
                const entries = await Promise.all(
                    accounts.map(async (profile) => ({
                        profile,
                        usage: await ideUsage.statsProfile(
                            profile.cli as CliUsage['cli'],
                            profile.id,
                        ),
                        // * Sign-in state: its login name (email) names the account; null when it cannot be read.
                        status: await ideAuth
                            .statusProfile(
                                profile.cli as AuthProvider,
                                profile.id,
                            )
                            .catch(() => null),
                    })),
                );
                // * An account that is not signed in is left out; one whose state cannot be read stays.
                const connected = entries.filter(
                    ({ status }) => status === null || status.loggedIn,
                );
                // * Ollama runs locally: it has no account or sign-in, so its numbers are read for the CLI itself (profile 0).
                const ollamaUsage = await ideUsage.statsProfile('ollama', 0);

                if (cancelled) {
                    return;
                }

                const accountsOf = (cli: string) =>
                    connected.filter(({ profile }) => profile.cli === cli)
                        .length;
                const next = connected.map(
                    ({ profile, usage, status }): AccountRow => {
                        const login = status?.account ?? null;
                        const cli = profile.cli as CliUsage['cli'];

                        return {
                            key: `${cli}:${profile.id}`,
                            id: profile.id,
                            // * "Claude / name" once there are several accounts of that CLI.
                            label:
                                accountsOf(cli) > 1
                                    ? `${CLI_LABELS[cli]} / ${login ?? profile.name}`
                                    : CLI_LABELS[cli],
                            usage,
                            // * Claude's own `/usage` is slow: it fills in per account when it arrives.
                            limits: cli === 'claude' ? undefined : null,
                        };
                    },
                );

                next.push({
                    key: 'ollama:0',
                    id: 0,
                    label: CLI_LABELS.ollama,
                    usage: ollamaUsage,
                    limits: null,
                });
                setRows(next);

                // * Each Claude account is read with its own login.
                for (const row of next) {
                    if (row.usage.cli !== 'claude') {
                        continue;
                    }

                    ideAuth
                        .claudeUsage(row.id)
                        .then((limits) => {
                            if (!cancelled) {
                                setLimitsOf(row.key, limits);
                            }
                        })
                        .catch(() => !cancelled && setLimitsOf(row.key, null));
                }
            })
            .catch((caught) => !cancelled && setFailure(errorText(caught)));

        return () => {
            cancelled = true;
        };
    }, [open]);

    // * Share of the last 7 days' turns: the CLIs do not report their remaining quota, so use is shown against each other.
    const total = (rows ?? []).reduce((sum, row) => sum + row.usage.turns7d, 0);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent className="flex max-h-[min(85vh,48rem)] flex-col sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{t('usage_dialog.ai_statistics')}</DialogTitle>
                    <DialogDescription>
                        {t('usage_dialog.which_clis_are_in')}
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {failure !== null ? (
                        <p role="alert" className="text-sm text-destructive">
                            {failure}
                        </p>
                    ) : rows === null ? (
                        <p className="text-sm text-muted-foreground">
                            {t('usage_dialog.loading')}
                        </p>
                    ) : rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            {t('usage_dialog.no_ai_account_connected')}
                        </p>
                    ) : (
                        <Tabs defaultValue="accounts">
                            <TabsList variant="line">
                                <TabsTrigger value="accounts">
                                    {t('usage_dialog.accounts_tab')}
                                </TabsTrigger>
                                <TabsTrigger value="charts">
                                    {t('usage_dialog.charts_tab')}
                                </TabsTrigger>
                            </TabsList>
                            <TabsContent value="accounts">
                                <ul className="flex min-w-0 flex-col gap-4 pt-2">
                                    {rows.map((row) => (
                                        <UsageRow
                                            key={row.key}
                                            label={row.label}
                                            usage={row.usage}
                                            share={
                                                total === 0
                                                    ? 0
                                                    : row.usage.turns7d / total
                                            }
                                            limits={row.limits}
                                            limitsPending={
                                                row.limits === undefined
                                            }
                                        />
                                    ))}
                                </ul>
                            </TabsContent>
                            <TabsContent value="charts">
                                <div className="min-w-0 rounded-lg border p-4 text-sm">
                                    <Tabs defaultValue="24h">
                                        <TabsList variant="line">
                                            <TabsTrigger value="24h">
                                                {t('usage_dialog.24_hours')}
                                            </TabsTrigger>
                                            <TabsTrigger value="7d">
                                                {t('usage_dialog.7_days')}
                                            </TabsTrigger>
                                        </TabsList>
                                        <TabsContent value="24h">
                                            <TokenChart
                                                title={t(
                                                    'usage_dialog.token_chart_24_hours',
                                                )}
                                                rows={rows}
                                                series={(usage) =>
                                                    usage.hourlyTokens
                                                }
                                                formatLabel={formatChartHour}
                                                labelEvery={6}
                                            />
                                        </TabsContent>
                                        <TabsContent value="7d">
                                            <TokenChart
                                                title={t(
                                                    'usage_dialog.token_chart_7_days',
                                                )}
                                                rows={rows}
                                                series={(usage) =>
                                                    usage.dailyTokens
                                                }
                                                formatLabel={formatChartDay}
                                                labelEvery={1}
                                            />
                                        </TabsContent>
                                    </Tabs>
                                </div>
                            </TabsContent>
                        </Tabs>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    {t('usage_dialog.calls_are_counted_on')}
                </p>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t('common.close')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const CHART_PADDING = 8;

/** Short day label (`dd/MM`) of the entry `index` of a 7-day series that ends today. */
const formatChartDay = (index: number, length: number): string =>
    new Date(
        Date.now() - (length - 1 - index) * 24 * 60 * 60 * 1000,
    ).toLocaleDateString('vi', { day: '2-digit', month: '2-digit' });

/** Hour label (`HH:00`) of the entry `index` of a 24-hour series that ends in the current hour. */
const formatChartHour = (index: number, length: number): string =>
    new Date(
        Date.now() - (length - 1 - index) * 60 * 60 * 1000,
    ).toLocaleTimeString('vi', { hour: '2-digit', minute: '2-digit' });

/** Line chart of the estimated tokens of each account over time (one series per account), all on one scale. */
function TokenChart({
    title,
    rows,
    series,
    formatLabel,
    labelEvery,
}: {
    title: string;
    rows: AccountRow[];
    series: (usage: CliUsage) => number[];
    /** Label of the point `index` of a series of `length` points. */
    formatLabel: (index: number, length: number) => string;
    /** Only every n-th point gets a label under the chart. */
    labelEvery: number;
}) {
    const length = rows[0] ? series(rows[0].usage).length : 0;
    const largest = Math.max(1, ...rows.flatMap((row) => series(row.usage)));
    const pointX = (index: number) =>
        CHART_PADDING +
        (index / Math.max(1, length - 1)) * (CHART_WIDTH - 2 * CHART_PADDING);
    const pointY = (tokens: number) =>
        CHART_HEIGHT -
        CHART_PADDING -
        (tokens / largest) * (CHART_HEIGHT - 2 * CHART_PADDING);

    return (
        <div className="flex flex-col gap-3 pt-3">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                    {t('usage_dialog.chart_peak', {
                        count: formatNumber(largest),
                    })}
                </span>
            </div>
            <svg
                role="img"
                aria-label={title}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="h-40 w-full"
            >
                {[0, 0.5, 1].map((fraction) => (
                    <line
                        key={fraction}
                        x1={CHART_PADDING}
                        x2={CHART_WIDTH - CHART_PADDING}
                        y1={pointY(largest * fraction)}
                        y2={pointY(largest * fraction)}
                        className="stroke-border"
                        strokeWidth={1}
                    />
                ))}
                {rows.map((row) => (
                    <g
                        key={row.key}
                        className={cn(CLI_COLORS[row.usage.cli].text)}
                    >
                        <polyline
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            points={series(row.usage)
                                .map(
                                    (tokens, index) =>
                                        `${pointX(index)},${pointY(tokens)}`,
                                )
                                .join(' ')}
                        />
                        {series(row.usage).map((tokens, index) => (
                            <circle
                                key={index}
                                cx={pointX(index)}
                                cy={pointY(tokens)}
                                r={3}
                                fill="currentColor"
                            >
                                <title>
                                    {`${row.label} · ${formatLabel(index, length)}: ${formatNumber(tokens)}`}
                                </title>
                            </circle>
                        ))}
                    </g>
                ))}
            </svg>
            <div className="relative h-4 text-xs text-muted-foreground tabular-nums">
                {Array.from({ length }, (_, index) => index)
                    .filter((index) => (length - 1 - index) % labelEvery === 0)
                    .map((index) => (
                        <span
                            key={index}
                            className="absolute top-0 whitespace-nowrap"
                            style={{
                                left: `${(pointX(index) / CHART_WIDTH) * 100}%`,
                                // * The first and last labels stay inside the chart instead of sticking out of the dialog.
                                transform: `translateX(${index === 0 ? '0' : index === length - 1 ? '-100%' : '-50%'})`,
                            }}
                        >
                            {formatLabel(index, length)}
                        </span>
                    ))}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {rows.map((row) => (
                    <li
                        key={row.key}
                        className={cn(
                            'flex items-center gap-1.5 font-medium',
                            CLI_COLORS[row.usage.cli].text,
                        )}
                    >
                        <span
                            aria-hidden="true"
                            className={cn(
                                'size-2 rounded-full',
                                CLI_COLORS[row.usage.cli].bar,
                            )}
                        />
                        {row.label}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function UsageRow({
    label,
    usage,
    share,
    limits,
    limitsPending,
}: {
    /** "Claude", or "Claude / account name" when the CLI has several accounts. */
    label: string;
    usage: CliUsage;
    share: number;
    /** Plan limits from the CLI's own `/usage` (Claude only); null when unreadable. */
    limits: LimitUsage[] | null | undefined;
    limitsPending: boolean;
}) {
    const Icon = CLI_ICONS[usage.cli];
    const stats: { label: string; value: string }[] = [
        {
            label: t('usage_dialog.24_hours'),
            value: t('usage_dialog.count_turns', { count: usage.turns24h }),
        },
        {
            label: t('usage_dialog.7_days'),
            value: t('usage_dialog.count_turns', { count: usage.turns7d }),
        },
        {
            label: 'Token',
            value: `${formatNumber(usage.tokens24h)} / ${formatNumber(usage.tokens7d)}`,
        },
        {
            label: t('usage_dialog.last_used'),
            value:
                usage.lastUsedAt === null
                    ? t('common.not_used')
                    : formatShortTime(usage.lastUsedAt),
        },
    ];

    return (
        <li className="flex flex-col gap-4 rounded-lg border p-4 text-sm">
            <div className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                <span
                    className={cn(
                        'flex-1 text-base font-semibold',
                        CLI_COLORS[usage.cli].text,
                    )}
                >
                    {label}
                </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {stats.map((stat) => (
                    <div key={stat.label} className="flex flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">
                            {stat.label}
                        </dt>
                        <dd className="font-medium tabular-nums">
                            {stat.value}
                        </dd>
                    </div>
                ))}
            </dl>
            {limits !== undefined && limits !== null ? (
                <div className="flex flex-col gap-3 border-t pt-4 text-xs">
                    {limits.map((limit) => {
                        const remaining =
                            limit.resets === null
                                ? null
                                : formatRemaining(limit.resets);

                        return (
                            <div
                                key={limit.label}
                                className="flex flex-col gap-1.5"
                            >
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="min-w-0 font-medium">
                                        {limitLabel(limit.label)}
                                    </span>
                                    <span className="shrink-0 text-muted-foreground tabular-nums">
                                        <span className="font-medium text-foreground">
                                            {limit.percent}%
                                        </span>
                                        {limit.resets !== null &&
                                            ` · ${t('common.resets_time', { time: formatReset(limit.resets) })}`}
                                        {remaining !== null &&
                                            ` · ${t('limit_usage.remaining', { duration: remaining })}`}
                                    </span>
                                </div>
                                <div
                                    role="progressbar"
                                    aria-label={limit.label}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={limit.percent}
                                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                                >
                                    <div
                                        className={cn(
                                            'h-full rounded-full',
                                            limitColor(limit.percent),
                                        )}
                                        style={{ width: `${limit.percent}%` }}
                                    />
                                </div>
                                {limit.percent >= 90 && (
                                    <p
                                        role="status"
                                        className="text-xs text-red-500"
                                    >
                                        {limit.resets === null
                                            ? t(
                                                  'limit_usage.near_limit_no_time',
                                              )
                                            : t('limit_usage.near_limit', {
                                                  time: formatReset(
                                                      limit.resets,
                                                  ),
                                              })}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : limitsPending ? (
                <p className="text-xs text-muted-foreground">
                    {t('usage_dialog.reading_usage')}
                </p>
            ) : (
                <div className="flex items-center gap-3 border-t pt-4 text-xs">
                    <div
                        role="progressbar"
                        aria-label={t('usage_dialog.7_day_usage_of', {
                            name: label,
                        })}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(share * 100)}
                        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                    >
                        <div
                            className={cn(
                                'h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
                                CLI_COLORS[usage.cli].bar,
                            )}
                            style={{ width: `${share * 100}%` }}
                        />
                    </div>
                    <span className="shrink-0 text-muted-foreground">
                        {t('usage_dialog.percent_of7_day', {
                            percent: Math.round(share * 100),
                        })}
                        {usage.models.length > 0 &&
                            ` · ${usage.models.join(', ')}`}
                    </span>
                </div>
            )}
        </li>
    );
}
