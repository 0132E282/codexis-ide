import { useMemo } from 'react';
import { unifiedDiff } from '@/lib/unified-diff';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** * A file's change as a unified diff (like a pull request): old and new line numbers, a +/− column, whole rows tinted, "@@" headers between the blocks. */
export function UnifiedDiff({
    before,
    after,
}: {
    before: string;
    after: string;
}) {
    const rows = useMemo(() => unifiedDiff(before, after), [before, after]);

    if (rows.length === 0) {
        return (
            <p className="px-4 py-3 text-xs text-muted-foreground">
                {t('unified_diff.no_differences')}
            </p>
        );
    }

    return (
        <div
            role="table"
            aria-label={t('unified_diff.file_changes')}
            className="max-h-[85vh] overflow-auto font-mono text-[13px] leading-[1.6] select-text"
        >
            {/* * As wide as the longest line, so the row tints reach the end while the block scrolls sideways. */}
            <div className="min-w-max">
                {rows.map((row, index) =>
                    row.kind === 'hunk' ? (
                        <div
                            key={index}
                            role="row"
                            className="bg-sky-500/10 px-4 py-1 text-xs text-muted-foreground"
                        >
                            {row.text}
                        </div>
                    ) : (
                        <div
                            key={index}
                            role="row"
                            className={cn(
                                'flex',
                                row.kind === '+' && 'bg-green-500/15',
                                row.kind === '-' && 'bg-red-500/15',
                            )}
                        >
                            <span
                                role="cell"
                                className="w-12 shrink-0 px-2 text-right text-muted-foreground tabular-nums select-none"
                            >
                                {row.oldNo}
                            </span>
                            <span
                                role="cell"
                                className="w-12 shrink-0 px-2 text-right text-muted-foreground tabular-nums select-none"
                            >
                                {row.newNo}
                            </span>
                            <span
                                role="cell"
                                aria-label={
                                    row.kind === '+'
                                        ? t('unified_diff.added')
                                        : row.kind === '-'
                                          ? t('unified_diff.removed')
                                          : undefined
                                }
                                className={cn(
                                    'w-5 shrink-0 text-center select-none',
                                    row.kind === '+' &&
                                        'text-green-700 dark:text-green-400',
                                    row.kind === '-' &&
                                        'text-red-700 dark:text-red-400',
                                )}
                            >
                                {row.kind === ' '
                                    ? ''
                                    : row.kind === '-'
                                      ? '−'
                                      : '+'}
                            </span>
                            <span
                                role="cell"
                                className="flex-1 pr-4 whitespace-pre"
                            >
                                {row.text}
                            </span>
                        </div>
                    ),
                )}
            </div>
        </div>
    );
}
