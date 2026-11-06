import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

// * Widths vary a little so the placeholder reads as a list of names, not a block.
const WIDTHS = ['w-3/5', 'w-4/5', 'w-2/5', 'w-3/4', 'w-1/2', 'w-2/3'];

/** * Placeholder rows while a list loads (a pulse that stands still for people who asked for less motion). */
export function LoadingRows({
    rows = 6,
    className,
}: {
    rows?: number;
    className?: string;
}) {
    return (
        <div
            role="status"
            aria-label={t('loading_rows.loading')}
            className={cn('flex flex-col gap-2.5 px-3 py-2', className)}
        >
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="flex items-center gap-2">
                    <span className="size-4 shrink-0 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                    <span
                        className={cn(
                            'h-3.5 animate-pulse rounded bg-muted motion-reduce:animate-none',
                            WIDTHS[index % WIDTHS.length],
                        )}
                    />
                </div>
            ))}
        </div>
    );
}
