import { Columns2, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import {
    ActivityTerminal,
    useTerminalSessions,
} from '@/components/ai-chat/activity-terminal';
import { DataPane } from '@/components/shell/data-pane';
import { GitHistoryPane } from '@/components/shell/git-history-pane';
import { PanelMenu } from '@/components/shell/panel-menu';
import { PlansPane } from '@/components/shell/plans-pane';
import { BackgroundTasksPane } from '@/components/shell/background-tasks-pane';
import { useBackgroundTasks } from '@/components/shell/chat/use-background-tasks';
import { Button } from '@/components/ui/button';
import type {
    DockedPlacement,
    PanelPlacement,
} from '@/hooks/use-panel-placement';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type BottomTab =
    'background' | 'terminal' | 'history' | 'plans' | 'data';

const ACTION_STYLE =
    'size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

/** The panel under the project: one tab bar (background tasks, terminal, git history) over the tab shown, like an editor's bottom panel. */
export function BottomPanel({
    tab,
    root,
    placement,
    dockedPlacement,
    historyPath,
    onPlacementChange,
    onClearHistoryPath,
    onTabChange,
    onClose,
    onOpenSubagent,
    onOpenFile,
}: {
    tab: BottomTab;
    /** Folder of the open project. */
    root: string | undefined;
    /** Where the panel sits: under the work area, filling it, or floating over it. */
    placement: PanelPlacement;
    dockedPlacement: DockedPlacement;
    /** The file the Lịch sử tab is limited to (null: the whole project). */
    historyPath: string | null;
    onPlacementChange: (placement: PanelPlacement) => void;
    onClearHistoryPath: () => void;
    onTabChange: (tab: BottomTab) => void;
    onClose: () => void;
    /** Opens the sub-agent view of the background task with this id. */
    onOpenSubagent: (id: string) => void;
    /** Opens a file of the project (path relative to it) in the editor. */
    onOpenFile: (path: string) => void;
}) {
    const sessions = useTerminalSessions(onClose);
    const { tasks, failed, stopTask, clearFinished } = useBackgroundTasks(root);
    const hasFinished = tasks.some((task) => task.state !== 'running');
    // * The shells start with the first visit to the Terminal tab and then stay alive while another tab is shown.
    const [terminalStarted, setTerminalStarted] = useState(tab === 'terminal');

    if (tab === 'terminal' && !terminalStarted) {
        setTerminalStarted(true);
    }

    const tabs: { id: BottomTab; label: string }[] = [
        { id: 'background', label: t('background_tasks.title') },
        { id: 'terminal', label: 'Terminal' },
        { id: 'history', label: t('history.title') },
        { id: 'plans', label: t('plans.title') },
        { id: 'data', label: t('data_pane.title') },
    ];

    return (
        <section
            aria-label={t('bottom_panel.label')}
            className="flex h-full min-h-0 flex-col bg-zinc-50 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
        >
            <header
                data-float-drag
                className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-200 px-2 text-xs dark:border-zinc-800"
            >
                <div
                    role="tablist"
                    aria-label={t('bottom_panel.label')}
                    className="flex h-full min-w-0 items-center gap-1 overflow-x-auto"
                >
                    {tabs.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={tab === item.id}
                            onClick={() => onTabChange(item.id)}
                            className={cn(
                                'flex h-full shrink-0 items-center border-b-2 px-2 text-zinc-500 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-zinc-400 dark:hover:text-zinc-100',
                                tab === item.id
                                    ? 'border-zinc-900 font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                                    : 'border-transparent',
                            )}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <span className="flex shrink-0 items-center gap-1">
                    {tab === 'terminal' ? (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t('activity_terminal.add_terminal')}
                                onClick={sessions.add}
                                className={ACTION_STYLE}
                            >
                                <Plus aria-hidden="true" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t(
                                    'activity_terminal.split_terminal',
                                )}
                                aria-pressed={sessions.split !== null}
                                onClick={sessions.divide}
                                className={cn(
                                    ACTION_STYLE,
                                    sessions.split !== null &&
                                        'bg-zinc-200 dark:bg-zinc-800',
                                )}
                            >
                                <Columns2 aria-hidden="true" />
                            </Button>
                        </>
                    ) : tab === 'background' ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={t('background_tasks.clear')}
                            aria-label={t('background_tasks.clear')}
                            disabled={!hasFinished}
                            onClick={() => void clearFinished()}
                            className={ACTION_STYLE}
                        >
                            <Trash2 aria-hidden="true" />
                        </Button>
                    ) : null}
                    <PanelMenu
                        placement={placement}
                        dockedPlacement={dockedPlacement}
                        floatable
                        edges={['bottom']}
                        onPlacementChange={onPlacementChange}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('bottom_panel.close')}
                        onClick={onClose}
                        className={ACTION_STYLE}
                    >
                        <X aria-hidden="true" />
                    </Button>
                </span>
            </header>
            <div className="min-h-0 flex-1">
                {tab === 'background' && (
                    <BackgroundTasksPane
                        tasks={tasks}
                        failed={failed}
                        onStop={(id) => void stopTask(id)}
                        onOpenSubagent={onOpenSubagent}
                    />
                )}
                {tab === 'data' && <DataPane root={root} />}
                {tab === 'history' && (
                    <GitHistoryPane
                        root={root}
                        filePath={historyPath}
                        onClearFile={onClearHistoryPath}
                    />
                )}
                {tab === 'plans' && (
                    <PlansPane key={root} root={root} onOpenFile={onOpenFile} />
                )}
                {terminalStarted && (
                    <ActivityTerminal
                        sessions={sessions}
                        root={root}
                        visible={tab === 'terminal'}
                    />
                )}
            </div>
        </section>
    );
}
