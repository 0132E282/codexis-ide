import type { ReactNode } from 'react';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import type {
    DockedPlacement,
    PanelPlacement,
} from '@/hooks/use-panel-placement';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type DockPanel = {
    id: string;
    placement: PanelPlacement;
    content: ReactNode;
    /** A closed panel stays mounted (its state survives) but takes no room. Default: open. */
    open?: boolean;
    /** Initial width (left, right) or height (top, bottom) in pixels. */
    size?: number;
    /** With no other panel and no work-area content, the panel takes the whole work area (side-chat.md S11). */
    fillWhenAlone?: boolean;
    /** Only for `bottom`: sits under `trailing` (the file area) only, not under `children` (the main chat). */
    underTrailing?: boolean;
};

const DEFAULT_SIZE = 320;
const MIN_SIZE = 160;
const MAX_SIZE = 960;

function DockedPanel({
    panel,
    placement,
}: {
    panel: DockPanel;
    placement: DockedPlacement;
}) {
    const vertical = placement === 'top' || placement === 'bottom';
    const axis = vertical ? 'y' : 'x';
    // * The handle sits on the edge facing the work area: leading for right and bottom, trailing for left and top.
    const trailing = placement === 'left' || placement === 'top';
    const size = useResizableWidth(
        `ide.size.${panel.id}.${axis}`,
        panel.size ?? DEFAULT_SIZE,
        MIN_SIZE,
        MAX_SIZE,
        axis,
        trailing ? 'trailing' : 'leading',
    );

    return (
        <div
            className={cn(
                'bg-background relative flex shrink-0 flex-col overflow-hidden',
                vertical && 'w-full',
                placement === 'left' && 'border-r',
                placement === 'right' && 'border-l',
                placement === 'top' && 'border-b',
                placement === 'bottom' && 'border-t',
            )}
            style={vertical ? { height: size.width } : { width: size.width }}
        >
            <ResizeHandle
                label={t('dock.resize_panel')}
                horizontal={vertical}
                className={cn(
                    placement === 'left' && 'right-0 left-auto translate-x-1/2',
                    placement === 'top' && 'top-auto bottom-0 translate-y-1/2',
                )}
                {...size.handleProps}
            />
            {panel.content}
        </div>
    );
}

/**
 * Draws the open dock panels around the work area (`children`): left, right, top and bottom edges, `fill`, and `float` (a card over the work area that pushes nothing).
 * Several panels on one edge sit side by side (left, right) or stacked (top, bottom), in the order given.
 * A panel set to `fill` takes the work area and the others are hidden, not unmounted, so their state survives; setting it back restores the layout.
 */
export function DockLayout({
    panels,
    children,
    trailing,
    trailingGrows = true,
    trailingFirst = false,
}: {
    panels: DockPanel[];
    children?: ReactNode;
    /** Area beside `children`; `underTrailing` bottom panels are drawn under it alone. Hidden with `children` while a panel fills. */
    trailing?: ReactNode;
    /** The trailing area takes the room left by `children` (an open editor); false: it is as wide as its own content (just the file tree) and `children` takes the rest. */
    trailingGrows?: boolean;
    /** The trailing area is drawn before `children` (the file area moved to the left of the main chat). */
    trailingFirst?: boolean;
}) {
    const alone =
        panels.filter((panel) => panel.open !== false).length === 1 &&
        children == null;
    const effective = panels.map((panel) => ({
        ...panel,
        placement:
            alone && panel.fillWhenAlone ? ('fill' as const) : panel.placement,
    }));
    const filled = effective.find(
        (panel) => panel.open !== false && panel.placement === 'fill',
    );

    const floating = effective.filter((panel) => panel.placement === 'float');

    const docked = (placement: DockedPlacement, scoped = false) =>
        effective
            .filter(
                (panel) =>
                    panel.placement === placement &&
                    (placement !== 'bottom' ||
                        (panel.underTrailing === true) === scoped),
            )
            .map((panel) => (
                <div
                    key={panel.id}
                    className={cn(
                        'flex',
                        (filled !== undefined || panel.open === false) &&
                            'hidden',
                    )}
                >
                    <DockedPanel panel={panel} placement={placement} />
                </div>
            ));

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col">{docked('top')}</div>
            <div className="flex min-h-0 min-w-0 flex-1">
                <div className="flex shrink-0">{docked('left')}</div>
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                    {children != null && (
                        <div
                            className={cn(
                                'flex min-h-0 min-w-0 flex-1',
                                filled !== undefined && 'hidden',
                            )}
                        >
                            {children}
                            {/* * A zero-width anchor on the right edge of the main chat: a floating panel hangs from it, over the chat and not over the file column. */}
                            <div className="relative z-20 w-0 shrink-0">
                                {floating.map((panel) => (
                                    <div
                                        key={panel.id}
                                        className={cn(
                                            'pointer-events-none absolute top-14 right-3 bottom-3 flex w-80 items-start justify-end',
                                            panel.open === false && 'hidden',
                                        )}
                                    >
                                        {panel.content}
                                    </div>
                                ))}
                            </div>
                            {trailing != null && (
                                <div
                                    className={cn(
                                        'flex min-h-0 min-w-0 flex-col',
                                        // * Drawn first, it is the chat's border that is no longer beside it, so it carries the line itself.
                                        trailingFirst && 'order-first border-r',
                                        trailingGrows
                                            ? 'flex-1'
                                            : // * The file tree is as wide as itself: any width kept for it would show as an empty column between the tree and the chat.
                                              'shrink-0',
                                    )}
                                >
                                    <div className="flex min-h-0 min-w-0 flex-1">
                                        {trailing}
                                    </div>
                                    <div className="flex shrink-0 flex-col">
                                        {docked('bottom', true)}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {filled !== undefined && (
                        <div
                            key={filled.id}
                            className="flex min-h-0 min-w-0 flex-1 flex-col"
                        >
                            {filled.content}
                        </div>
                    )}
                </div>
                <div className="flex shrink-0">{docked('right')}</div>
            </div>
            <div className="flex shrink-0 flex-col">{docked('bottom')}</div>
        </div>
    );
}
