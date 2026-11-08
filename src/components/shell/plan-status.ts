import { t } from '@/lib/i18n';
import type { PlanDocStatus, PlanTask } from '@/lib/ide';

/** Texts and colours of the plan statuses, shared by the card list and the detail view. */
export const STATUS_TEXT: Record<PlanDocStatus, string> = {
    done: 'plans.status_done',
    in_progress: 'plans.status_in_progress',
    partial: 'plans.status_partial',
    todo: 'plans.status_todo',
    draft: 'plans.status_draft',
    review: 'plans.status_review',
    unknown: 'plans.status_unknown',
};

export const STATUS_STYLE: Record<PlanDocStatus, string> = {
    done: 'bg-green-500/15 text-green-700 dark:text-green-400',
    in_progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    draft: 'bg-zinc-500/20 text-zinc-700 dark:text-zinc-300',
    review: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
    todo: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
    unknown: 'bg-muted text-muted-foreground',
};

export const BAR_STYLE: Record<PlanDocStatus, string> = {
    done: 'bg-green-500',
    in_progress: 'bg-blue-500',
    partial: 'bg-amber-500',
    draft: 'bg-zinc-400',
    review: 'bg-violet-500',
    todo: 'bg-zinc-300 dark:bg-zinc-600',
    unknown: 'bg-zinc-300 dark:bg-zinc-600',
};

/** The message that hands the tasks that are not done (any status but done) of a plan to the AI; null when none is left. */
export function continuePrompt(path: string, tasks: PlanTask[]): string | null {
    const open = tasks.filter((task) => task.status !== 'done');

    return open.length === 0
        ? null
        : t('plans.continue_prompt', {
              path,
              tasks: open
                  .map((task) =>
                      [task.id, task.title]
                          .filter((part) => part !== null)
                          .join(' '),
                  )
                  .join('; '),
          });
}
