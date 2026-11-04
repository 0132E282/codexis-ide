import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ClaudeIcon, CodexIcon } from '@/icons';
import { errorText } from '@/lib/ide';
import { ideAuth, type LimitUsage } from '@/lib/ide-auth';
import { ideProfiles } from '@/lib/ide-profiles';
import { LIMIT_LABELS, formatReset, limitColor } from '@/lib/limit-usage';
import { ideUsage, type CliUsage, type UsageStats } from '@/lib/ide-usage';
import { cn } from '@/lib/utils';

const CLI_LABELS: Record<CliUsage['cli'], string> = {
    claude: 'Claude',
    codex: 'Codex',
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
};

const CLI_ICONS = { claude: ClaudeIcon, codex: CodexIcon };

const formatNumber = (value: number): string =>
    new Intl.NumberFormat('vi').format(value);

const formatShortTime = (seconds: number): string =>
    new Date(seconds * 1000).toLocaleString('vi', {
        dateStyle: 'short',
        timeStyle: 'short',
    });

/** AI statistics ("Thống kê AI"): turns, estimated tokens and models of each CLI, and which one stopped at its limit. */
export function UsageDialog({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [stats, setStats] = useState<UsageStats | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    // * Claude's own `/usage` (slow): undefined while it loads, null when it cannot be read.
    const [limits, setLimits] = useState<LimitUsage[] | null | undefined>(
        undefined,
    );

    // * Read again each time the dialog opens: the numbers change after every turn.
    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;

        setFailure(null);
        ideUsage
            .stats()
            .then((next) => !cancelled && setStats(next))
            .catch((caught) => !cancelled && setFailure(errorText(caught)));
        setLimits(undefined);
        ideProfiles
            .list()
            .then((all) => {
                const active = all.find(
                    (profile) => profile.cli === 'claude' && profile.active,
                );

                return ideAuth.claudeUsage(active?.id ?? 0);
            })
            .then((next) => !cancelled && setLimits(next))
            .catch(() => !cancelled && setLimits(null));

        return () => {
            cancelled = true;
        };
    }, [open]);

    // * Share of the last 7 days' turns: the CLIs do not report their remaining quota, so use is shown against each other.
    const total = (stats?.clis ?? []).reduce(
        (sum, usage) => sum + usage.turns7d,
        0,
    );

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
                    <DialogTitle>Thống kê AI</DialogTitle>
                    <DialogDescription>
                        CLI nào đang dùng và CLI nào đã dừng vì hạn mức.
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {failure !== null ? (
                        <p role="alert" className="text-sm text-destructive">
                            {failure}
                        </p>
                    ) : stats === null ? (
                        <p className="text-sm text-muted-foreground">
                            Đang tải…
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {stats.clis.map((usage) => (
                                <UsageRow
                                    key={usage.cli}
                                    usage={usage}
                                    share={
                                        total === 0 ? 0 : usage.turns7d / total
                                    }
                                    limits={
                                        usage.cli === 'claude'
                                            ? limits
                                            : undefined
                                    }
                                    limitsPending={
                                        usage.cli === 'claude' &&
                                        limits === undefined
                                    }
                                />
                            ))}
                        </ul>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    Lượt gọi tính trên máy này trong 24 giờ và 7 ngày qua (không
                    lưu nội dung, chỉ lưu độ dài). &quot;Đạt limit&quot; hiện
                    khi lỗi hạn mức mới hơn lượt thành công gần nhất; CLI không
                    cho biết hạn mức còn lại. Token chỉ là ước lượng (~4 ký tự
                    một token).
                </p>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Đóng
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function UsageRow({
    usage,
    share,
    limits,
    limitsPending,
}: {
    usage: CliUsage;
    share: number;
    /** Plan limits from the CLI's own `/usage` (Claude only); null when unreadable. */
    limits: LimitUsage[] | null | undefined;
    limitsPending: boolean;
}) {
    const Icon = CLI_ICONS[usage.cli];
    const stats: { label: string; value: string }[] = [
        { label: '24 giờ', value: `${usage.turns24h} lượt` },
        { label: '7 ngày', value: `${usage.turns7d} lượt` },
        {
            label: 'Token',
            value: `${formatNumber(usage.tokens24h)} / ${formatNumber(usage.tokens7d)}`,
        },
        {
            label: 'Dùng cuối',
            value:
                usage.lastUsedAt === null
                    ? 'Chưa dùng'
                    : formatShortTime(usage.lastUsedAt),
        },
    ];

    return (
        <li className={cn('flex flex-col gap-3 rounded-md border p-3 text-sm')}>
            <div className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                <span
                    className={cn(
                        'flex-1 text-base font-semibold',
                        CLI_COLORS[usage.cli].text,
                    )}
                >
                    {CLI_LABELS[usage.cli]}
                </span>
            </div>
            <dl className="flex flex-nowrap justify-between gap-x-4 overflow-hidden">
                {stats.map((stat) => (
                    <div
                        key={stat.label}
                        className="flex items-baseline gap-1.5 whitespace-nowrap"
                    >
                        <dt className="shrink-0 text-xs text-muted-foreground">
                            {stat.label}
                        </dt>
                        <dd className="font-medium tabular-nums">
                            {stat.value}
                        </dd>
                    </div>
                ))}
            </dl>
            {limits !== undefined && limits !== null ? (
                <div className="flex flex-col gap-1.5 text-xs">
                    {limits.map((limit) => (
                        <div
                            key={limit.label}
                            className="flex items-center gap-3"
                        >
                            <span className="w-10 shrink-0 text-muted-foreground">
                                {LIMIT_LABELS[limit.label] ?? limit.label}
                            </span>
                            <div
                                role="progressbar"
                                aria-label={limit.label}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={limit.percent}
                                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                            >
                                <div
                                    className={cn(
                                        'h-full rounded-full',
                                        limitColor(limit.percent),
                                    )}
                                    style={{ width: `${limit.percent}%` }}
                                />
                            </div>
                            <span className="w-8 shrink-0 text-right tabular-nums">
                                {limit.percent}%
                            </span>
                            {limit.resets !== null && (
                                <span className="shrink-0 text-muted-foreground">
                                    Đặt lại {formatReset(limit.resets)}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            ) : limitsPending ? (
                <p className="text-xs text-muted-foreground">
                    Đang đọc /usage…
                </p>
            ) : (
                <div className="flex items-center gap-3 text-xs">
                    <div
                        role="progressbar"
                        aria-label={`Mức sử dụng 7 ngày của ${CLI_LABELS[usage.cli]}`}
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
                        {Math.round(share * 100)}% lượt 7 ngày
                        {usage.models.length > 0 &&
                            ` · ${usage.models.join(', ')}`}
                    </span>
                </div>
            )}
        </li>
    );
}
