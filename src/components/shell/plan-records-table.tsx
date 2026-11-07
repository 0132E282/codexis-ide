import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/hooks/use-confirm';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/ide';
import { ideActivity } from '@/lib/ide-activity';
import type { PlanRecord } from '@/lib/ide-activity';

/** The index of the plan files of the project (the files stay the source of truth): sync with `docs/plans`, and delete index rows (never the plan files). */
export function PlanRecordsTable({ root }: { root: string | undefined }) {
    const [records, setRecords] = useState<PlanRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [refreshTick, setRefreshTick] = useState(0);
    const { confirm, dialog } = useConfirm();

    useEffect(() => {
        let current = true;

        ideActivity.planRecordsList(root).then(
            (result) => {
                if (current) {
                    setRecords(result);
                    setPicked(new Set());
                    setError(null);
                    setLoading(false);
                }
            },
            (failure: unknown) => {
                if (current) {
                    setError(errorText(failure));
                    setLoading(false);
                }
            },
        );

        return () => {
            current = false;
        };
    }, [root, refreshTick]);

    const sync = async () => {
        setSyncing(true);

        try {
            const result = await ideActivity.planRecordsSync(root);

            toast.success(
                t('data_pane.plans_synced', {
                    upserted: result.upserted,
                    removed: result.removed,
                }),
            );
            setRefreshTick((tick) => tick + 1);
        } catch (failure) {
            toast.error(t(errorText(failure)));
        } finally {
            setSyncing(false);
        }
    };

    const deletePicked = async () => {
        const approved = await confirm({
            title: t('data_pane.delete_title'),
            description: t('data_pane.plans_delete_description', {
                count: picked.size,
            }),
            action: t('common.delete'),
        });

        if (!approved) {
            return;
        }

        try {
            await ideActivity.planRecordsDelete([...picked]);
            setRefreshTick((tick) => tick + 1);
        } catch (failure) {
            toast.error(t(errorText(failure)));
        }
    };

    return (
        <div className="flex flex-col gap-2 p-2 text-xs">
            {dialog}
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={syncing}
                    onClick={() => void sync()}
                >
                    <RefreshCw aria-hidden="true" />
                    {t('data_pane.sync')}
                </Button>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="ml-auto"
                    disabled={picked.size === 0}
                    onClick={() => void deletePicked()}
                >
                    {t('data_pane.delete_selected', { count: picked.size })}
                </Button>
            </div>
            {error !== null && (
                <p role="alert" className="text-destructive">
                    {t(error)}
                </p>
            )}
            {loading && (
                <p className="text-muted-foreground">{t('history.loading')}</p>
            )}
            {!loading && error === null && records.length === 0 && (
                <p className="text-muted-foreground">
                    {t('data_pane.plans_empty')}
                </p>
            )}
            {records.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left">
                        <thead className="bg-muted/50 text-muted-foreground">
                            <tr>
                                <th className="w-8 px-2 py-1.5">
                                    <Checkbox
                                        aria-label={t('data_pane.select_all')}
                                        checked={picked.size === records.length}
                                        onCheckedChange={(checked) =>
                                            setPicked(
                                                checked === true
                                                    ? new Set(
                                                          records.map(
                                                              (record) =>
                                                                  record.id,
                                                          ),
                                                      )
                                                    : new Set(),
                                            )
                                        }
                                    />
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                    {t('data_pane.plan_title')}
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                    {t('data_pane.status')}
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                    {t('data_pane.tasks')}
                                </th>
                                <th className="w-full px-2 py-1.5 font-medium">
                                    {t('data_pane.path')}
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                    {t('data_pane.updated')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.map((record) => (
                                <tr key={record.id} className="border-t">
                                    <td className="px-2 py-1">
                                        <Checkbox
                                            aria-label={record.title}
                                            checked={picked.has(record.id)}
                                            onCheckedChange={(checked) =>
                                                setPicked((current) => {
                                                    const next = new Set(
                                                        current,
                                                    );

                                                    if (checked === true) {
                                                        next.add(record.id);
                                                    } else {
                                                        next.delete(record.id);
                                                    }

                                                    return next;
                                                })
                                            }
                                        />
                                    </td>
                                    <td className="max-w-64 truncate px-2 py-1">
                                        {record.title}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap">
                                        {record.status}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap tabular-nums">
                                        {record.tasksDone}/{record.tasksTotal}
                                    </td>
                                    <td
                                        title={record.path}
                                        className="max-w-0 truncate px-2 py-1 text-muted-foreground"
                                    >
                                        {record.path}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                                        {new Date(
                                            record.updatedAt * 1000,
                                        ).toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
