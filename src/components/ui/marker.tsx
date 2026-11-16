import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const markerVariants = cva(
    'flex min-w-0 items-center gap-2 text-sm text-muted-foreground',
    {
        variants: {
            variant: {
                default: '',
                border: 'border-b pb-2',
                separator:
                    'before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border',
            },
        },
        defaultVariants: { variant: 'default' },
    },
);

function Marker({
    className,
    variant,
    ...props
}: React.ComponentProps<'div'> & VariantProps<typeof markerVariants>) {
    return (
        <div
            data-slot="marker"
            data-variant={variant ?? 'default'}
            className={cn(markerVariants({ variant }), className)}
            {...props}
        />
    );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<'span'>) {
    return (
        <span
            data-slot="marker-icon"
            aria-hidden="true"
            className={cn('shrink-0 [&_svg]:size-4', className)}
            {...props}
        />
    );
}

function MarkerContent({ className, ...props }: React.ComponentProps<'span'>) {
    return (
        <span
            data-slot="marker-content"
            className={cn('min-w-0', className)}
            {...props}
        />
    );
}

export { Marker, MarkerContent, MarkerIcon, markerVariants };
