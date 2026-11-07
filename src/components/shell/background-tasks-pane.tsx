import { ChevronDown, ChevronRight, Square } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { BackgroundTask, BackgroundTaskState } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const STATE_TEXT: Record<BackgroundTaskState, string> = {
    running: 'background_tasks.running',
    done: 'background_tasks.done',
    failed: 'background_tasks.failed',
    stopped: 'background_tasks.stopped',
};

const STATE_STYLE: Record<BackgroundTaskState, string> = {
    running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    done: 'bg-green-500/15 text-green-600 dark:text-green-400',
    failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
    stopped: 'bg-muted text-muted-foreground',
};

function TaskRow({
    task,
    onStop,
    onOpenSubagent,
}: {
    task: BackgroundTask;
    onStop: (id: string) => void;
    onOpenSubagent: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const isSubagent = task.kind === 'subagent';
    const time = new Date(task.startedAt * 1000).toLocaleTimeString();

    return (
        <li className="border-b px-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
                <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={t('background_tasks.toggle_output')}
                    onClick={() => setExpanded((current) => !current)}
                    className="shrink-0 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    {expanded ? (
                        <ChevronDown aria-hidden="true" className="size-4" />
                    ) : (
                        <ChevronRight aria-hidden="true" className="size-4" />
                    )}
                </button>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {t(
                        isSubagent
                            ? 'background_tasks.subagent'
                            : 'background_tasks.shell',
                    )}
                </span>
                {isSubagent ? (
                    <button
                        type="button"
                        title={t('background_tasks.open_subagent')}
                        onClick={() => onOpenSubagent(task.id)}
                        className="min-w-0 flex-1 truncate text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                        {task.label}
                    </button>
                ) : (
                    <span
                        title={task.label}
                        className="min-w-0 flex-1 truncate font-mono text-xs"
                    >
                        {task.label}
                    </span>
                )}
                <span
                    className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs',
                        STATE_STYLE[task.state],
                    )}
                >
                    {t(STATE_TEXT[task.state])}
                </span>
                <span
                    title={t('background_tasks.started_at', { time })}
                    className="hidden shrink-0 text-xs text-muted-foreground sm:inline"
                >
                    {time}
                </span>
                {task.state === 'running' && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        title={
                            isSubagent
                                ? t('background_tasks.stop_subagent')
                                : t('background_tasks.stop')
                        }
                        aria-label={t('background_tasks.stop')}
                        onClick={() => onStop(task.id)}
                    >
                        <Square aria-hidden="true" className="size-3.5" />
                    </Button>
                )}
            </div>
            {expanded && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs/5 break-words whitespace-pre-wrap text-muted-foreground">
                    {task.outputTail === ''
                        ? t('background_tasks.no_output')
                        : task.outputTail}
                </pre>
            )}
        </li>
    );
}

/** Background tab of the bottom panel: what the AI runs in the background (shell commands and sub-agents) of one project, with stop. */
export function BackgroundTasksPane({
    tasks,
    failed,
    onStop,
    onOpenSubagent,
}: {
    tasks: BackgroundTask[];
    failed: boolean;
    onStop: (id: string) => void;
    /** Opens the sub-agent view of the task with this id. */
    onOpenSubagent: (id: string) => void;
}) {
    return (
        <section
            aria-label={t('background_tasks.title')}
            className="flex h-full min-h-0 flex-col bg-background"
        >
            {tasks.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
                    <Square
                        aria-hidden="true"
                        className="size-6 text-muted-foreground"
                    />
                    <p className="text-sm font-medium">
                        {t('background_tasks.empty')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {failed
                            ? t('background_tasks.unavailable')
                            : t('background_tasks.empty_hint')}
                    </p>
                </div>
            ) : (
                <ul className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    {tasks.map((task) => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            onStop={onStop}
                            onOpenSubagent={onOpenSubagent}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}
