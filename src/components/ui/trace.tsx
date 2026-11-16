'use client';

import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Trace({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="trace"
            className={cn('flex min-w-0 flex-col gap-2 text-sm', className)}
            {...props}
        />
    );
}

function TraceCollapsible(
    props: React.ComponentProps<typeof CollapsiblePrimitive.Root>,
) {
    return (
        <CollapsiblePrimitive.Root data-slot="trace-collapsible" {...props} />
    );
}

function TraceCollapsibleTrigger({
    className,
    ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
    return (
        <CollapsiblePrimitive.Trigger
            data-slot="trace-collapsible-trigger"
            className={cn(
                'w-full rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                className,
            )}
            {...props}
        />
    );
}

function TraceCollapsibleContent({
    className,
    ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
    return (
        <CollapsiblePrimitive.Content
            data-slot="trace-collapsible-content"
            className={cn('mt-2', className)}
            {...props}
        />
    );
}

const traceLineVariants = cva('flex min-w-0 items-center gap-2', {
    variants: {
        status: {
            default: 'text-foreground',
            error: 'text-destructive',
        },
    },
    defaultVariants: { status: 'default' },
});

function TraceLine({
    className,
    status,
    ...props
}: React.ComponentProps<'div'> & VariantProps<typeof traceLineVariants>) {
    return (
        <div
            data-slot="trace-line"
            className={cn(traceLineVariants({ status }), className)}
            {...props}
        />
    );
}

function TraceIcon({ className, ...props }: React.ComponentProps<'span'>) {
    return (
        <span
            data-slot="trace-icon"
            aria-hidden="true"
            className={cn('shrink-0 [&_svg]:size-4', className)}
            {...props}
        />
    );
}

function TraceTitle({ className, ...props }: React.ComponentProps<'span'>) {
    return (
        <span
            data-slot="trace-title"
            className={cn('min-w-0 truncate', className)}
            {...props}
        />
    );
}

export {
    Trace,
    TraceCollapsible,
    TraceCollapsibleContent,
    TraceCollapsibleTrigger,
    TraceIcon,
    TraceLine,
    TraceTitle,
};
