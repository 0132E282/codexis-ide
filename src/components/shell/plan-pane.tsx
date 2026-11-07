import {
    CheckCircle2,
    Circle,
    CircleDot,
    ClipboardList,
    X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type PlanTodoStatus = 'pending' | 'in_progress' | 'completed';

export type PlanTodo = {
    content: string;
    status: PlanTodoStatus;
};

/** The plan of the open chat as the backend sends it (docs/system/plan-pane.md, 3.7): the todos and the plan text, either may be missing. */
export type PlanData = {
    todos: PlanTodo[];
    markdown: string | null;
};

const STATUS_ICON = {
    pending: Circle,
    in_progress: CircleDot,
    completed: CheckCircle2,
} satisfies Record<PlanTodoStatus, typeof Circle>;

const STATUS_LABEL: Record<PlanTodoStatus, string> = {
    pending: 'plan_pane.status_pending',
    in_progress: 'plan_pane.status_in_progress',
    completed: 'plan_pane.status_completed',
};

function TodoList({ todos }: { todos: PlanTodo[] }) {
    return (
        <ul className="flex flex-col gap-1.5">
            {todos.map((todo, index) => {
                const Icon = STATUS_ICON[todo.status];

                return (
                    <li
                        // * The list is replaced as a whole by each TodoWrite, so the position is its identity.
                        key={index}
                        data-status={todo.status}
                        className="flex items-start gap-2 text-sm"
                    >
                        <Icon
                            aria-label={t(STATUS_LABEL[todo.status])}
                            role="img"
                            className={cn(
                                'mt-0.5 size-4 shrink-0',
                                todo.status === 'pending' &&
                                    'text-muted-foreground',
                                todo.status === 'in_progress' && 'text-primary',
                                todo.status === 'completed' &&
                                    'text-emerald-500',
                            )}
                        />
                        <span
                            className={cn(
                                'min-w-0 break-words',
                                todo.status === 'completed' &&
                                    'text-muted-foreground line-through',
                            )}
                        >
                            {todo.content}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

function EmptyPlan() {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <ClipboardList
                aria-hidden="true"
                className="size-8 text-muted-foreground"
            />
            <p className="text-sm font-medium">{t('plan_pane.empty_title')}</p>
            <p className="text-xs text-muted-foreground">
                {t('plan_pane.empty_hint')}
            </p>
        </div>
    );
}

/** The Plan pane of the right dock: the todos and the plan text the AI writes during a turn. Read only; the data comes through props. */
export function PlanPane({
    plan,
    placementMenu,
    onClose,
}: {
    plan: PlanData | null;
    /** The Move / Fill and arrange menu button, shared by the dock panels. */
    placementMenu: ReactNode;
    onClose: () => void;
}) {
    const hasTodos = plan !== null && plan.todos.length > 0;
    const hasMarkdown = plan !== null && (plan.markdown ?? '').trim() !== '';

    return (
        <section
            aria-label={t('plan_pane.title')}
            className="flex h-full min-h-0 min-w-0 flex-col bg-background"
        >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                <h2 className="truncate text-sm font-medium">
                    {t('plan_pane.title')}
                </h2>
                <div className="flex items-center">
                    {placementMenu}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('plan_pane.close')}
                        title={t('plan_pane.close')}
                        onClick={onClose}
                        className="text-muted-foreground"
                    >
                        <X aria-hidden="true" className="size-4" />
                    </Button>
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {hasTodos || hasMarkdown ? (
                    <div className="flex flex-col gap-4 p-3">
                        {hasTodos && <TodoList todos={plan.todos} />}
                        {hasMarkdown && (
                            <MarkdownContent content={plan.markdown ?? ''} />
                        )}
                    </div>
                ) : (
                    <EmptyPlan />
                )}
            </div>
        </section>
    );
}
