import type { ReactNode } from 'react';
import { PlanPane } from '@/components/shell/plan-pane';
import type { PlanData } from '@/components/shell/plan-pane';
import { cn } from '@/lib/utils';

/** The Plan pane of a project. It stays mounted while hidden; the frame (edge, size, fill) comes from DockLayout. */
export function PlanDock({
    plan,
    open,
    placementMenu,
    onClose,
}: {
    plan: PlanData | null;
    open: boolean;
    placementMenu: ReactNode;
    onClose: () => void;
}) {
    return (
        <aside
            hidden={!open}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.defaultPrevented) {
                    onClose();
                }
            }}
            className={cn(
                'relative min-h-0 min-w-0 flex-1 flex-col bg-background',
                open && 'flex',
            )}
        >
            <PlanPane
                plan={plan}
                placementMenu={placementMenu}
                onClose={onClose}
            />
        </aside>
    );
}
