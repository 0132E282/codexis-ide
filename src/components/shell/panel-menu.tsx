import {
    Columns2,
    ExternalLink,
    Maximize2,
    PanelBottom,
    PanelLeft,
    PanelRight,
    PanelTop,
    PictureInPicture2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
    DockedPlacement,
    PanelPlacement,
} from '@/hooks/use-panel-placement';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const MOVES: {
    placement: DockedPlacement;
    icon: LucideIcon;
    labelKey: string;
}[] = [
    { placement: 'left', icon: PanelLeft, labelKey: 'panel_menu.left' },
    {
        placement: 'right',
        icon: PanelRight,
        labelKey: 'panel_menu.right',
    },
    { placement: 'top', icon: PanelTop, labelKey: 'panel_menu.top' },
    {
        placement: 'bottom',
        icon: PanelBottom,
        labelKey: 'panel_menu.bottom',
    },
];

function PlacementItem({
    active,
    icon: Icon,
    label,
    className,
    onSelect,
}: {
    active: boolean;
    icon: LucideIcon;
    label: string;
    className?: string;
    onSelect: () => void;
}) {
    return (
        <DropdownMenuItem
            aria-label={label}
            aria-checked={active}
            role="menuitemradio"
            title={label}
            onSelect={onSelect}
            className={cn(
                'justify-center',
                active && 'bg-accent text-accent-foreground',
                className,
            )}
        >
            <Icon aria-hidden="true" />
        </DropdownMenuItem>
    );
}

/**
 * The menu of a dock panel: Move (left, right, top, bottom, and Float when offered) and Fill and arrange (fill the work area, or go back beside the other panels).
 * Open in new window is shown only when the panel can move into a separate window (`onOpenWindow`).
 */
export function PanelMenu({
    placement,
    dockedPlacement,
    floatable = false,
    edges,
    onPlacementChange,
    onOpenWindow,
    openWindowLabelKey = 'bottom_panel.open_window',
}: {
    placement: PanelPlacement;
    /** The edge to return to when the panel leaves `fill`. */
    dockedPlacement: DockedPlacement;
    /** Offers the Float choice: the panel hovers over the work area instead of taking room. */
    floatable?: boolean;
    /** The edges offered under Move (default: all four). */
    edges?: readonly DockedPlacement[];
    onPlacementChange: (placement: PanelPlacement) => void;
    /** Offers "Open in new window": moves the whole panel into a separate window. */
    onOpenWindow?: () => void;
    /** Text of that item (default: the bottom panel's). */
    openWindowLabelKey?: string;
}) {
    const filled = placement === 'fill';
    const floating = placement === 'float';
    const [open, setOpen] = useState(false);
    const closeTimer = useRef<number | undefined>(undefined);

    // * Hovering the button (or the menu) shows where the panel can go, like Claude; a short delay lets the pointer cross the gap between them.
    const hoverOpen = () => {
        window.clearTimeout(closeTimer.current);
        setOpen(true);
    };
    const hoverClose = () => {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(() => setOpen(false), 150);
    };

    useEffect(() => () => window.clearTimeout(closeTimer.current), []);

    return (
        <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('panel_menu.open')}
                    className="text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
                    onPointerEnter={hoverOpen}
                    onPointerLeave={hoverClose}
                >
                    <Maximize2 aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                onPointerEnter={hoverOpen}
                onPointerLeave={hoverClose}
            >
                <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground text-xs">
                        {t('panel_menu.move')}
                    </DropdownMenuLabel>
                    <div className="flex gap-1 px-1 pb-1">
                        {MOVES.filter(
                            ({ placement: target }) =>
                                edges === undefined || edges.includes(target),
                        ).map(({ placement: target, icon, labelKey }) => (
                            <PlacementItem
                                key={target}
                                active={placement === target}
                                icon={icon}
                                label={t(labelKey)}
                                // * A narrow window has no room beside the editor: left and right are hidden.
                                className={cn(
                                    'flex-1',
                                    (target === 'left' || target === 'right') &&
                                        'max-sm:hidden',
                                )}
                                onSelect={() => onPlacementChange(target)}
                            />
                        ))}
                        {floatable && (
                            <PlacementItem
                                active={floating}
                                icon={PictureInPicture2}
                                label={t('panel_menu.float')}
                                className="flex-1"
                                onSelect={() =>
                                    onPlacementChange(
                                        floating ? dockedPlacement : 'float',
                                    )
                                }
                            />
                        )}
                    </div>
                </DropdownMenuGroup>
                <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground text-xs">
                        {t('panel_menu.fill_and_arrange')}
                    </DropdownMenuLabel>
                    <div className="flex gap-1 px-1 pb-1">
                        <PlacementItem
                            active={filled}
                            icon={Maximize2}
                            label={t('panel_menu.fill')}
                            className="flex-1"
                            onSelect={() =>
                                onPlacementChange(
                                    filled ? dockedPlacement : 'fill',
                                )
                            }
                        />
                        <PlacementItem
                            active={!filled && !floating}
                            icon={Columns2}
                            label={t('panel_menu.arrange')}
                            className="flex-1"
                            onSelect={() => onPlacementChange(dockedPlacement)}
                        />
                    </div>
                </DropdownMenuGroup>
                {onOpenWindow !== undefined && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onOpenWindow}>
                            <ExternalLink aria-hidden="true" />
                            {t(openWindowLabelKey)}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
