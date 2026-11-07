import type { PlanDocStatus } from '@/lib/ide';

/** Texts and colours of the plan statuses, shared by the card list and the detail view. */
export const STATUS_TEXT: Record<PlanDocStatus, string> = {
    done: 'plans.status_done',
    in_progress: 'plans.status_in_progress',
    partial: 'plans.status_partial',
    todo: 'plans.status_todo',
    draft: 'plans.status_draft',
    unknown: 'plans.status_unknown',
};

export const STATUS_STYLE: Record<PlanDocStatus, string> = {
    done: 'bg-green-500/15 text-green-700 dark:text-green-400',
    in_progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    draft: 'bg-zinc-500/20 text-zinc-700 dark:text-zinc-300',
    todo: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
    unknown: 'bg-muted text-muted-foreground',
};

export const BAR_STYLE: Record<PlanDocStatus, string> = {
    done: 'bg-green-500',
    in_progress: 'bg-blue-500',
    partial: 'bg-amber-500',
    draft: 'bg-zinc-400',
    todo: 'bg-zinc-300 dark:bg-zinc-600',
    unknown: 'bg-zinc-300 dark:bg-zinc-600',
};
