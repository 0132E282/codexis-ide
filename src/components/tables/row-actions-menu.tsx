import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/i18n';

export type RowActionItem = {
    label: string;
    onSelect: () => void;
    destructive?: boolean;
    disabled?: boolean;
    icon?: LucideIcon;
    separatorBefore?: boolean;
};

/** * Three-dots menu for a table row's actions, aligned to the end of the cell. */
export function RowActionsMenu({
    items,
    triggerLabel = t('row_actions_menu.open_actions_menu'),
    triggerClassName = 'size-8',
    iconClassName = 'size-4',
    trigger,
}: {
    items: RowActionItem[];
    triggerLabel?: string;
    triggerClassName?: string;
    /** * Size class of each item's icon. */
    iconClassName?: string;
    /** * Replaces the default button; it is rendered as the menu trigger, so it must accept a ref and props. */
    trigger?: ReactNode;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {trigger ?? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={triggerClassName}
                        aria-label={triggerLabel}
                    >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {items.map(
                    (
                        {
                            label,
                            onSelect,
                            destructive,
                            disabled,
                            icon: Icon,
                            separatorBefore,
                        },
                        index,
                    ) => (
                        <Fragment key={`${index}-${label}`}>
                            {separatorBefore && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                                variant={
                                    destructive ? 'destructive' : undefined
                                }
                                disabled={disabled}
                                onSelect={onSelect}
                            >
                                {Icon && <Icon className={iconClassName} />}
                                {label}
                            </DropdownMenuItem>
                        </Fragment>
                    ),
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
