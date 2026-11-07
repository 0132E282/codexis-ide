import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** * Thin drag bar on a panel's left edge (or, with `horizontal`, its top edge); spread `useResizableWidth().handleProps` onto it. */
export function ResizeHandle({
    label,
    horizontal = false,
    className,
    ...props
}: { label: string; horizontal?: boolean } & ComponentProps<'div'>) {
    return (
        <div
            aria-label={label}
            className={cn(
                'group absolute z-10 flex touch-none items-center justify-center transition-colors hover:bg-ring/40 focus-visible:bg-ring/60 focus-visible:outline-none data-[dragging=true]:bg-ring/60',
                horizontal
                    ? 'inset-x-0 top-0 h-1.5 -translate-y-1/2 cursor-row-resize'
                    : 'inset-y-0 left-0 w-1.5 -translate-x-1/2 cursor-col-resize',
                className,
            )}
            {...props}
        >
            {/* Grip shown on hover or while dragging, so the handle is visible even at the panel's full size. */}
            <span
                aria-hidden="true"
                className={cn(
                    'pointer-events-none rounded-full bg-ring opacity-0 transition-opacity group-hover:opacity-100 group-data-[dragging=true]:opacity-100',
                    horizontal ? 'h-0.5 w-8' : 'h-8 w-0.5',
                )}
            />
        </div>
    );
}
