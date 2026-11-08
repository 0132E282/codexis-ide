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
                {!isSubagent && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {t('background_tasks.shell')}
                    </span>
                )}
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

type TaskCategory =
    'terminal' | 'python' | 'node' | 'rust' | 'subagent' | 'other';

// * The category tabs, in the order shown; a tab appears only while it has tasks.
const CATEGORIES: { id: TaskCategory; label: string }[] = [
    { id: 'terminal', label: 'background_tasks.category_terminal' },
    { id: 'python', label: 'background_tasks.category_python' },
    { id: 'node', label: 'background_tasks.category_node' },
    { id: 'rust', label: 'background_tasks.category_rust' },
    { id: 'subagent', label: 'subagents.title' },
    { id: 'other', label: 'background_tasks.category_other' },
];

// * The first word of a shell command, by what it runs.
const COMMAND_CATEGORY: Record<string, TaskCategory> = {
    python: 'python',
    python3: 'python',
    pip: 'python',
    pip3: 'python',
    uv: 'python',
    pytest: 'python',
    node: 'node',
    npm: 'node',
    pnpm: 'node',
    yarn: 'node',
    npx: 'node',
    bun: 'node',
    deno: 'node',
    vite: 'node',
    tsc: 'node',
    cargo: 'rust',
    rustc: 'rust',
    sh: 'terminal',
    bash: 'terminal',
    zsh: 'terminal',
    fish: 'terminal',
    cd: 'terminal',
    ls: 'terminal',
    cat: 'terminal',
    tail: 'terminal',
    grep: 'terminal',
    git: 'terminal',
    make: 'terminal',
    curl: 'terminal',
    docker: 'terminal',
    ssh: 'terminal',
    sleep: 'terminal',
    echo: 'terminal',
};

/** The category tab a task belongs to: sub-agents have their own, a shell command goes by its first word. */
function categoryOf(task: BackgroundTask): TaskCategory {
    if (task.kind === 'subagent') {
        return 'subagent';
    }

    const command = task.label.trim().split(/\s+/)[0] ?? '';
    const name = command.split('/').pop() ?? '';

    return COMMAND_CATEGORY[name] ?? 'other';
}

/** The Việc chạy nền tab of the bottom panel: what the AI runs in the background of one project, with stop; a small tab bar splits it into terminal, python, node, rust, sub-agent and other. */
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
    const [chosen, setChosen] = useState<TaskCategory>('terminal');
    const counts = new Map<TaskCategory, number>();

    for (const task of tasks) {
        const category = categoryOf(task);

        counts.set(category, (counts.get(category) ?? 0) + 1);
    }

    const categories = CATEGORIES.filter((item) => counts.has(item.id));
    // * A tab whose tasks are all gone falls back to the first that has some.
    const category = counts.has(chosen) ? chosen : categories[0]?.id;
    const shown = tasks.filter((task) => categoryOf(task) === category);

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
                <>
                    <div
                        role="tablist"
                        aria-label={t('background_tasks.categories')}
                        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {categories.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={category === item.id}
                                onClick={() => setChosen(item.id)}
                                className={cn(
                                    'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                    category === item.id &&
                                        'bg-accent font-medium text-accent-foreground',
                                )}
                            >
                                {t(item.label)}
                                <span className="text-[11px] opacity-70">
                                    {counts.get(item.id)}
                                </span>
                            </button>
                        ))}
                    </div>
                    <ul className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                        {shown.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                onStop={onStop}
                                onOpenSubagent={onOpenSubagent}
                            />
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}
