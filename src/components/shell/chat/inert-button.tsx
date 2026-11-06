import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export const NOT_AVAILABLE = 'Chưa có trong IDE: chưa có trợ lý AI.';

/** An icon button that is shown but cannot be used yet. */
export function Inert({
    label,
    className,
    children,
}: {
    label: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled
            aria-label={label}
            title={NOT_AVAILABLE}
            className={className}
        >
            {children}
        </Button>
    );
}
