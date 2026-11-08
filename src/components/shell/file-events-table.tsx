import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/hooks/use-confirm';
import { t } from '@/lib/i18n';
import { formatBytes } from '@/lib/format-bytes';
import { errorText } from '@/lib/ide';
import { ideActivity } from '@/lib/ide-activity';
import type {
    FileEvent,
    FileEventAction,
    FileEventSource,
} from '@/lib/ide-activity';

const PAGE_SIZE = 100;
const ACTIONS: FileEventAction[] = [
    'create',
    'save',
    'delete',
    'rename',
    'copy',
    'move',
    'discard',
    'ai_edit',
];
const SELECT_CLASS =
    'h-8 rounded-sm border border-input bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The log of file edits (who changed which file, when, how many lines): filters, pages of 100, and deletion of picked rows or of everything (before a date). */
export function FileEventsTable({ root }: { root: string | undefined }) {
    const [path, setPath] = useState('');
    const [action, setAction] = useState<FileEventAction | ''>('');
    const [source, setSource] = useState<FileEventSource | ''>('');
    const [before, setBefore] = useState('');
    const [page, setPage] = useState(0);
    const [items, setItems] = useState<FileEvent[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [refreshTick, setRefreshTick] = useState(0);
    const { confirm, dialog } = useConfirm();

    useEffect(() => {
        let current = true;

        setLoading(true);
        ideActivity
            .fileEventsList(
                {
                    path: path.trim() === '' ? undefined : path.trim(),
                    action: action === '' ? undefined : action,
                    source: source === '' ? undefined : source,
                },
                PAGE_SIZE,
                page * PAGE_SIZE,
                root,
            )
            .then((result) => {
                if (current) {
                    setItems(result.items);
                    setTotal(result.total);
                    setError(null);
                    setPicked(new Set());
                    setLoading(false);
                }
            })
            .catch((failure: unknown) => {
                if (current) {
                    setError(errorText(failure));
                    setLoading(false);
                }
            });

        return () => {
            current = false;
        };
    }, [root, path, action, source, page, refreshTick]);

    const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

    const deletePicked = async () => {
        const approved = await confirm({
            title: t('data_pane.delete_title'),
            description: t('data_pane.events_delete_description', {
                count: picked.size,
            }),
            action: t('common.delete'),
        });

        if (!approved) {
            return;
        }

        try {
            await ideActivity.fileEventsDelete([...picked]);
            refresh();
        } catch (failure) {
            toast.error(t(errorText(failure)));
        }
    };

    const clearAll = async () => {
        const date = before === '' ? undefined : new Date(before);
        const approved = await confirm({
            title: t('data_pane.delete_title'),
            description:
                date === undefined
                    ? t('data_pane.events_clear_all_description')
                    : t('data_pane.events_clear_before_description', {
                          date: date.toLocaleDateString(),
                      }),
            action: t('common.delete'),
        });

        if (!approved) {
            return;
        }

        try {
            await ideActivity.fileEventsClear(
                date === undefined
                    ? undefined
                    : Math.floor(date.getTime() / 1000),
                root,
            );
            setPage(0);
            refresh();
        } catch (failure) {
            toast.error(t(errorText(failure)));
        }
    };

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="flex flex-col gap-2 p-2">
            {dialog}
            <div className="flex flex-wrap items-center gap-2">
                <Field
                    name="events-path"
                    className="w-56"
                    value={path}
                    placeholder={t('data_pane.filter_path')}
                    aria-label={t('data_pane.filter_path')}
                    autoComplete="off"
                    onChange={(event) => {
                        setPage(0);
                        setPath(event.target.value);
                    }}
                />
                <select
                    aria-label={t('data_pane.action')}
                    value={action}
                    onChange={(event) => {
                        setPage(0);
                        setAction(event.target.value as FileEventAction | '');
                    }}
                    className={SELECT_CLASS}
                >
                    <option value="">{t('data_pane.all_actions')}</option>
                    {ACTIONS.map((item) => (
                        <option key={item} value={item}>
                            {t(`data_pane.action_${item}`)}
                        </option>
                    ))}
                </select>
                <select
                    aria-label={t('data_pane.source')}
                    value={source}
                    onChange={(event) => {
                        setPage(0);
                        setSource(event.target.value as FileEventSource | '');
                    }}
                    className={SELECT_CLASS}
                >
                    <option value="">{t('data_pane.all_sources')}</option>
                    <option value="user">{t('data_pane.source_user')}</option>
                    <option value="ai">{t('data_pane.source_ai')}</option>
                </select>
                <span className="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        aria-label={t('data_pane.before_date')}
                        value={before}
                        onChange={(event) => setBefore(event.target.value)}
                        className={SELECT_CLASS}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={total === 0}
                        onClick={() => void clearAll()}
                    >
                        {before === ''
                            ? t('data_pane.delete_all')
                            : t('data_pane.delete_before')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={picked.size === 0}
                        onClick={() => void deletePicked()}
                    >
                        {t('data_pane.delete_selected', {
                            count: picked.size,
                        })}
                    </Button>
                </span>
            </div>
            {error !== null && (
                <p role="alert" className="text-destructive">
                    {t(error)}
                </p>
            )}
            {loading && (
                <p className="text-muted-foreground">{t('history.loading')}</p>
            )}
            {!loading && error === null && items.length === 0 && (
                <p className="text-muted-foreground">
                    {t('data_pane.events_empty')}
                </p>
            )}
            {items.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left">
                        <thead className="bg-muted/50 text-muted-foreground">
                            <tr>
                                <th className="w-8 px-2 py-1.5">
                                    <Checkbox
                                        aria-label={t('data_pane.select_all')}
                                        checked={picked.size === items.length}
                                        onCheckedChange={(checked) =>
                                            setPicked(
                                                checked === true
                                                    ? new Set(
                                                          items.map(
                                                              (item) => item.id,
                                                          ),
                                                      )
                                                    : new Set(),
                                            )
                                        }
                                    />
                                </th>
                                <th className="px-2 py-1.5 font-medium whitespace-nowrap">
                                    {t('data_pane.time')}
                                </th>
                                <th className="px-2 py-1.5 font-medium whitespace-nowrap">
                                    {t('data_pane.action')}
                                </th>
                                <th className="px-2 py-1.5 font-medium whitespace-nowrap">
                                    {t('data_pane.source')}
                                </th>
                                <th className="w-full px-2 py-1.5 font-medium whitespace-nowrap">
                                    {t('data_pane.path')}
                                </th>
                                <th className="px-2 py-1.5 font-medium whitespace-nowrap">
                                    {t('data_pane.lines')}
                                </th>
                                <th className="px-2 py-1.5 font-medium whitespace-nowrap">
                                    {t('data_pane.size')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item) => (
                                <tr key={item.id} className="border-t">
                                    <td className="px-2 py-1">
                                        <Checkbox
                                            aria-label={item.path}
                                            checked={picked.has(item.id)}
                                            onCheckedChange={(checked) =>
                                                setPicked((current) => {
                                                    const next = new Set(
                                                        current,
                                                    );

                                                    if (checked === true) {
                                                        next.add(item.id);
                                                    } else {
                                                        next.delete(item.id);
                                                    }

                                                    return next;
                                                })
                                            }
                                        />
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                                        {new Date(
                                            item.createdAt * 1000,
                                        ).toLocaleString()}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap">
                                        {t(`data_pane.action_${item.action}`)}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap">
                                        {t(`data_pane.source_${item.source}`)}
                                    </td>
                                    <td
                                        title={item.path}
                                        className="max-w-0 truncate px-2 py-1"
                                    >
                                        {item.path}
                                        {item.oldPath !== null && (
                                            <span className="text-muted-foreground">
                                                {' ← '}
                                                {item.oldPath}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap tabular-nums">
                                        {item.linesAdded === null &&
                                        item.linesRemoved === null ? (
                                            '—'
                                        ) : (
                                            <>
                                                <span className="text-green-600">
                                                    +{item.linesAdded ?? 0}
                                                </span>{' '}
                                                <span className="text-red-600">
                                                    −{item.linesRemoved ?? 0}
                                                </span>
                                            </>
                                        )}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap text-muted-foreground tabular-nums">
                                        {item.bytesAfter === null
                                            ? '—'
                                            : formatBytes(item.bytesAfter)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
                <span>{t('data_pane.total', { count: total })}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                >
                    {t('data_pane.previous')}
                </Button>
                <span className="tabular-nums">
                    {page + 1} / {pageCount}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={page + 1 >= pageCount}
                    onClick={() => setPage(page + 1)}
                >
                    {t('data_pane.next')}
                </Button>
            </div>
        </div>
    );
}
