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
                'absolute z-10 touch-none transition-colors hover:bg-ring/40 focus-visible:bg-ring/60 focus-visible:outline-none',
                horizontal
                    ? 'inset-x-0 top-0 h-1.5 -translate-y-1/2 cursor-row-resize'
                    : 'inset-y-0 left-0 w-1.5 -translate-x-1/2 cursor-col-resize',
                className,
            )}
            {...props}
        />
    );
}
