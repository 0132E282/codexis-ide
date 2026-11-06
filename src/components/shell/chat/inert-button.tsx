import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export const NOT_AVAILABLE = 'inert_button.not_available_in_the';

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
            title={t(NOT_AVAILABLE)}
            className={className}
        >
            {children}
        </Button>
    );
}
