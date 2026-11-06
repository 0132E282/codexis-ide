import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ide, errorText } from '@/lib/ide';
import type { ToolListing, ToolScope } from '@/lib/ide-tools';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type ToolColumn<T> = {
    header: string;
    /** `detail` is true on the detail page, where nothing is shortened. */
    cell: (row: T, detail?: boolean) => ReactNode;
    /** Shorten the cell to two lines in the table; false for cells that lay out their own blocks. Default true. */
    clamp?: boolean;
    /** Takes the width the other columns leave, so the table never outgrows the dialog. Use it on one long-text column. */
    grow?: boolean;
};

const SCOPE_LABEL: Record<ToolScope, string> = {
    project: 'common.projects',
    machine: 'tool_table.this_machine',
};

/** Source cell: scope badge, file path and, for project files, an "open in VS Code" button. */
export function SourceCell({
    scope,
    path,
    relativePath,
    compact = false,
}: {
    scope: ToolScope;
    path: string;
    relativePath?: string | null;
    /** Table cell: just the scope badge. The detail page shows the path and the VS Code button. */
    compact?: boolean;
}) {
    return (
        <div
            className={cn(
                'flex max-w-full flex-col items-start gap-1',
                !compact && 'w-56',
            )}
        >
            <Badge variant={scope === 'project' ? 'default' : 'secondary'}>
                {t(SCOPE_LABEL[scope])}
            </Badge>
            {compact ? null : (
                <>
                    <span
                        title={path}
                        className={cn(
                            'w-full text-xs text-muted-foreground',
                            compact ? 'truncate' : 'break-all',
                        )}
                    >
                        {path}
                    </span>
                    {relativePath ? (
                        <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={(event) => {
                                event.stopPropagation();
                                void ide.openInVscode(relativePath);
                            }}
                        >
                            {t('common.open_in_vs_code')}
                        </Button>
                    ) : null}
                </>
            )}
        </div>
    );
}

/** Loads a read-only listing once when the tab opens and shows it as a filterable table. */
export function ToolTable<T>({
    load,
    columns,
    name,
    emptyText,
}: {
    load: () => Promise<ToolListing<T>>;
    columns: ToolColumn<T>[];
    name: (row: T) => string;
    emptyText: string;
}) {
    const [listing, setListing] = useState<ToolListing<T> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    // * The row opened on its own page; the table is left until "Quay lại".
    const [selected, setSelected] = useState<T | null>(null);

    useEffect(() => {
        let active = true;

        load()
            .then((result) => active && setListing(result))
            .catch((reason: unknown) => active && setError(errorText(reason)));

        return () => {
            active = false;
        };
    }, [load]);

    const rows = useMemo(() => {
        const needle = filter.trim().toLowerCase();

        return (listing?.items ?? []).filter((row) =>
            name(row).toLowerCase().includes(needle),
        );
    }, [listing, filter, name]);

    if (error) {
        return <p className="text-sm text-destructive">{error}</p>;
    }

    if (!listing) {
        return (
            <p className="text-sm text-muted-foreground">
                {t('common.loading')}
            </p>
        );
    }

    if (selected !== null) {
        return (
            <div className="flex animate-in flex-col gap-4 duration-200 fade-in-0 slide-in-from-right-2 motion-reduce:animate-none">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-fit gap-1.5"
                    onClick={() => setSelected(null)}
                >
                    <ArrowLeft aria-hidden="true" />
                    {t('common.back')}
                </Button>
                <h4 className="text-lg font-semibold">{name(selected)}</h4>
                <dl className="flex flex-col gap-4">
                    {columns.map((column) => (
                        <div
                            key={column.header}
                            className="flex flex-col gap-1"
                        >
                            <dt className="text-xs font-medium text-muted-foreground">
                                {t(column.header)}
                            </dt>
                            <dd className="text-sm whitespace-pre-wrap">
                                {column.cell(selected, true)}
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>
        );
    }

    return (
        <div className="flex animate-in flex-col gap-3 duration-150 fade-in-0 motion-reduce:animate-none">
            <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('tool_table.filter_by_name')}
            />
            {listing.warnings.map((warning) => (
                <p key={warning} className="text-xs text-destructive">
                    {warning}
                </p>
            ))}
            <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                            {columns.map((column, columnIndex) => (
                                <th
                                    key={column.header}
                                    className={cn(
                                        'px-3 py-2 font-medium',
                                        columnIndex === 0 && 'min-w-48',
                                        column.clamp === false &&
                                            'w-px whitespace-nowrap',
                                        column.grow && 'w-full',
                                    )}
                                >
                                    {t(column.header)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length}
                                    className="px-3 py-6 text-center text-muted-foreground"
                                >
                                    {listing.items.length === 0
                                        ? t(emptyText)
                                        : t('tool_table.no_items_match_the')}
                                </td>
                            </tr>
                        ) : (
                            rows.map((row, index) => (
                                <tr
                                    key={index}
                                    tabIndex={0}
                                    onClick={() => setSelected(row)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            setSelected(row);
                                        }
                                    }}
                                    className="cursor-pointer border-t align-top transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                                >
                                    {columns.map((column, columnIndex) => (
                                        <td
                                            key={column.header}
                                            className={cn(
                                                'px-3 py-2',
                                                columnIndex === 0 && 'min-w-48',
                                                column.clamp === false &&
                                                    'w-px whitespace-nowrap',
                                                column.grow && 'w-full max-w-0',
                                            )}
                                        >
                                            {column.clamp === false ? (
                                                column.cell(row)
                                            ) : (
                                                <div className="line-clamp-2">
                                                    {column.cell(row)}
                                                </div>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
