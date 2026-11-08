import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/i18n';

export type PanelsMenuItem = {
    id: string;
    icon: LucideIcon;
    label: string;
    shortcut?: string;
    open: boolean;
    onToggle: () => void;
};

/**
 * The "..." menu of the dock panels (Side chat, Background tasks, Plans): one row each, ticked while the panel is open; a click toggles it.
 * The icon leads each row and the tick ends it. Where a panel sits is chosen in the panel's own header (PanelMenu).
 */
export function PanelsMenu({ items }: { items: PanelsMenuItem[] }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('panels_menu.open')}
                    title={t('panels_menu.open')}
                    className="text-muted-foreground"
                >
                    <MoreHorizontal aria-hidden="true" className="size-5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
                {items.map((item) => (
                    <DropdownMenuItem
                        key={item.id}
                        role="menuitemcheckbox"
                        aria-checked={item.open}
                        data-testid={`panels-menu-${item.id}`}
                        onSelect={item.onToggle}
                    >
                        <item.icon aria-hidden="true" />
                        {item.label}
                        {item.shortcut !== undefined && (
                            <DropdownMenuShortcut>
                                {item.shortcut}
                            </DropdownMenuShortcut>
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
