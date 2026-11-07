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
    grow = false,
}: {
    panel: DockPanel;
    placement: DockedPlacement;
    /** Takes the whole room of its column instead of its own height (a bottom panel with nothing above it). */
    grow?: boolean;
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
                'bg-background relative flex flex-col overflow-hidden',
                grow ? 'min-h-0 flex-1' : 'shrink-0',
                vertical && 'w-full',
                placement === 'left' && 'border-r',
                placement === 'right' && 'border-l',
                placement === 'top' && 'border-b',
                placement === 'bottom' && 'border-t',
            )}
            style={
                grow
                    ? undefined
                    : vertical
                      ? { height: size.width }
                      : { width: size.width }
            }
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
    trailingHidden = false,
    trailingEmpty = false,
}: {
    panels: DockPanel[];
    children?: ReactNode;
    /** Area beside `children`; `underTrailing` bottom panels are drawn under it alone. Hidden with `children` while a panel fills. */
    trailing?: ReactNode;
    /** The trailing area takes the room left by `children` (an open editor); false: it is as wide as its own content (just the file tree) and `children` takes the rest. */
    trailingGrows?: boolean;
    /** The trailing area is drawn before `children` (the file area moved to the left of the main chat). */
    trailingFirst?: boolean;
    /** The trailing area is folded away (hidden, not unmounted, so its state survives). */
    trailingHidden?: boolean;
    /** The trailing area has nothing to show (no file, no tree): a bottom panel under it takes its whole height, with no empty part above. */
    trailingEmpty?: boolean;
}) {
    // * The width of the column when only a bottom panel is in it: dragged by the edge that faces the chat (the left one, or the right one when the column is drawn first); not saved per panel, so it is one size for the column.
    const columnWidth = useResizableWidth(
        'ide.size.bottom-column.x',
        480,
        384,
        MAX_SIZE,
        'x',
        trailingFirst ? 'trailing' : 'leading',
    );
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

    // * Under a file area that is only the tree, the panel keeps a usable width (the chat gives way) instead of the tree's.
    const scopedBottomOpen = effective.some(
        (panel) =>
            panel.open !== false &&
            panel.placement === 'bottom' &&
            panel.underTrailing === true,
    );
    const bottomGrows = trailingEmpty && scopedBottomOpen;
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
                    inert={panel.open === false}
                    className={cn(
                        // * Opens and closes by growing the room from nothing (and fading); the panel stays mounted. Reduced motion: at once.
                        'grid transition-[grid-template-rows,grid-template-columns,opacity,visibility] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                        placement === 'top' || placement === 'bottom'
                            ? panel.open === false
                                ? 'grid-rows-[0fr]'
                                : 'grid-rows-[1fr]'
                            : panel.open === false
                              ? 'grid-cols-[0fr]'
                              : 'grid-cols-[1fr]',
                        panel.open === false && 'invisible opacity-0',
                        scoped && bottomGrows && 'min-h-0 flex-1',
                        filled !== undefined && 'hidden',
                    )}
                >
                    <div
                        className={cn(
                            'flex overflow-hidden',
                            placement === 'top' || placement === 'bottom'
                                ? 'min-h-0 flex-col'
                                : 'min-w-0',
                        )}
                    >
                        <DockedPanel
                            panel={panel}
                            placement={placement}
                            grow={scoped && bottomGrows}
                        />
                    </div>
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
                                    style={
                                        bottomGrows && !trailingGrows
                                            ? { width: columnWidth.width }
                                            : undefined
                                    }
                                    className={cn(
                                        'relative flex min-h-0 flex-col',
                                        bottomGrows &&
                                            !trailingGrows &&
                                            'max-w-full',
                                        trailingHidden && 'hidden',
                                        !trailingGrows && scopedBottomOpen
                                            ? 'min-w-96'
                                            : 'min-w-0',
                                        // * Drawn first, it is the chat's border that is no longer beside it, so it carries the line itself.
                                        trailingFirst && 'order-first border-r',
                                        // * Tree only, with the bottom panel under it wider than the tree: the line runs the column's full height (the tree's own edge stops at the tree); -ml-px lays it over the chat's border so the two are not doubled.
                                        !trailingFirst &&
                                            !trailingGrows &&
                                            scopedBottomOpen &&
                                            '-ml-px border-l',
                                        trailingGrows
                                            ? 'flex-1'
                                            : // * The file tree is as wide as itself: any width kept for it would show as an empty column between the tree and the chat.
                                              'shrink-0',
                                    )}
                                >
                                    {bottomGrows && !trailingGrows && (
                                        <ResizeHandle
                                            label={t('dock.resize_panel')}
                                            className={cn(
                                                'z-10',
                                                trailingFirst &&
                                                    'right-0 left-auto translate-x-1/2',
                                            )}
                                            {...columnWidth.handleProps}
                                        />
                                    )}
                                    <div
                                        className={cn(
                                            'flex min-h-0 min-w-0 flex-1',
                                            bottomGrows && 'hidden',
                                        )}
                                    >
                                        {trailing}
                                    </div>
                                    <div
                                        className={cn(
                                            // * w-0 min-w-full: the panel takes the width of the column and never widens it with its own content (a long history row would leave an empty gap between the file and the tree).
                                            'flex w-0 min-w-full flex-col',
                                            bottomGrows
                                                ? 'min-h-0 flex-1'
                                                : 'shrink-0',
                                        )}
                                    >
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
