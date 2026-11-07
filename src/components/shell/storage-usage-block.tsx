import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/use-confirm';
import { formatBytes } from '@/lib/format-bytes';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/ide';
import { ideActivity } from '@/lib/ide-activity';
import type {
    StorageCleanupKind,
    StorageUsage,
    StorageWarning,
} from '@/lib/ide-activity';

const CLEANUP_KINDS: StorageCleanupKind[] = [
    'file_events',
    'chat_images',
    'plan_records',
    'run_logs',
    'session_plans',
];
const LEVEL_RANK: Record<StorageWarning['level'], number> = {
    notice: 1,
    warning: 2,
    critical: 3,
};

/** The data the IDE keeps for the project (edit log, pictures, plan index, run logs...): sizes, a warning level, and a clean-up the person confirms; nothing is ever removed on its own. */
export function StorageUsageBlock({
    root,
    refreshKey,
}: {
    root: string;
    refreshKey: number;
}) {
    const [usage, setUsage] = useState<StorageUsage | null>(null);
    const [failed, setFailed] = useState(false);
    const [cleaning, setCleaning] = useState(false);
    const [kinds, setKinds] = useState<Set<StorageCleanupKind>>(new Set());
    const [days, setDays] = useState('30');
    const [reloadTick, setReloadTick] = useState(0);
    const { confirm, dialog } = useConfirm();

    useEffect(() => {
        let current = true;

        ideActivity.storageUsage(root).then(
            (result) => {
                if (current) {
                    setUsage(result);
                    setFailed(false);
                }
            },
            () => current && setFailed(true),
        );

        return () => {
            current = false;
        };
    }, [root, refreshKey, reloadTick]);

    const warnings = [
        ...(usage?.warnings ?? []),
        ...(usage?.app.warnings ?? []),
    ];
    const worst = warnings.reduce<StorageWarning['level'] | null>(
        (level, warning) =>
            level === null || LEVEL_RANK[warning.level] > LEVEL_RANK[level]
                ? warning.level
                : level,
        null,
    );
    const needsAction = worst === 'warning' || worst === 'critical';

    const open = useCallback(() => {
        setKinds(
            new Set(
                warnings
                    .map((warning) => warning.kind)
                    .filter((kind): kind is StorageCleanupKind =>
                        (CLEANUP_KINDS as string[]).includes(kind),
                    ),
            ),
        );
        setCleaning(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [usage]);

    const clean = async () => {
        const olderThanDays = days.trim() === '' ? undefined : Number(days);

        if (
            olderThanDays !== undefined &&
            (!Number.isFinite(olderThanDays) || olderThanDays < 0)
        ) {
            toast.error(t('storage.bad_days'));

            return;
        }

        const approved = await confirm({
            title: t('storage.cleanup_title'),
            description:
                olderThanDays === undefined
                    ? t('storage.cleanup_confirm_all', { count: kinds.size })
                    : t('storage.cleanup_confirm_old', {
                          count: kinds.size,
                          days: olderThanDays,
                      }),
            action: t('storage.cleanup'),
        });

        if (!approved) {
            return;
        }

        let deleted = 0;

        try {
            for (const kind of kinds) {
                const result = await ideActivity.storageCleanup(kind, {
                    olderThanDays,
                    root,
                    confirm: true,
                });

                deleted += result.deleted;
            }

            toast.success(t('storage.cleaned', { count: deleted }));
            setCleaning(false);
            setReloadTick((tick) => tick + 1);
        } catch (failure) {
            toast.error(t(errorText(failure)));
        }
    };

    if (usage === null) {
        return failed ? (
            <p className="text-xs text-muted-foreground">
                {t('session_rail.load_failed')}
            </p>
        ) : null;
    }

    return (
        <div className="flex flex-col gap-2">
            {dialog}
            <ul className="flex flex-col gap-1 text-xs">
                {usage.items.map((item) => {
                    const warning = warnings.find(
                        (candidate) => candidate.kind === item.kind,
                    );

                    return (
                        <li
                            key={item.kind}
                            className="flex items-center justify-between gap-2"
                        >
                            <span className="text-muted-foreground">
                                {t(`storage.kind_${item.kind}`)}
                            </span>
                            <span className="flex items-center gap-1.5 tabular-nums">
                                {item.count} · {formatBytes(item.bytes)}
                                {warning !== undefined && (
                                    <Badge
                                        variant={
                                            warning.level === 'critical'
                                                ? 'destructive'
                                                : 'secondary'
                                        }
                                    >
                                        {t(`storage.level_${warning.level}`)}
                                    </Badge>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
            {needsAction && (
                <p
                    role="alert"
                    className="text-xs text-amber-600 dark:text-amber-400"
                >
                    {t('storage.warning_message')}
                </p>
            )}
            <Button
                type="button"
                variant={needsAction ? 'default' : 'outline'}
                size="sm"
                className="w-fit"
                onClick={open}
            >
                {t('storage.cleanup')}
            </Button>
            <Dialog open={cleaning} onOpenChange={setCleaning}>
                <DialogContent>
                    <DialogTitle>{t('storage.cleanup_title')}</DialogTitle>
                    <DialogDescription>
                        {t('storage.cleanup_description')}
                    </DialogDescription>
                    <ul className="flex flex-col gap-2">
                        {CLEANUP_KINDS.map((kind) => (
                            <li
                                key={kind}
                                className="flex items-center gap-2 text-sm"
                            >
                                <Checkbox
                                    id={`cleanup-${kind}`}
                                    checked={kinds.has(kind)}
                                    onCheckedChange={(checked) =>
                                        setKinds((current) => {
                                            const next = new Set(current);

                                            if (checked === true) {
                                                next.add(kind);
                                            } else {
                                                next.delete(kind);
                                            }

                                            return next;
                                        })
                                    }
                                />
                                <label htmlFor={`cleanup-${kind}`}>
                                    {t(`storage.kind_${kind}`)}
                                </label>
                            </li>
                        ))}
                    </ul>
                    <Field
                        name="cleanup-days"
                        label={t('storage.older_than_days')}
                        description={t('storage.older_than_days_hint')}
                        value={days}
                        inputMode="numeric"
                        autoComplete="off"
                        onChange={(event) => setDays(event.target.value)}
                    />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setCleaning(false)}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={kinds.size === 0}
                            onClick={() => void clean()}
                        >
                            {t('storage.cleanup')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
