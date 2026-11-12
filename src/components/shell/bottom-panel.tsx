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
import type { useBackgroundTasks } from '@/components/shell/chat/use-background-tasks';
import { Button } from '@/components/ui/button';
import type {
    DockedPlacement,
    PanelPlacement,
} from '@/hooks/use-panel-placement';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** What the Terminal menu of the menu bar asks of the terminal tab. */
export type TerminalCommand = {
    action: 'new' | 'split';
    isFresh: boolean;
};

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
    background,
    onOpenSubagent,
    onOpenFile,
    onSendPrompt,
    runningPrompts,
    terminalCommand,
    onDetach,
}: {
    tab: BottomTab;
    /** Folder of the open project. */
    root: string | undefined;
    /** The background tasks of the open project (one source, shared with the sidebar shortcuts). */
    background: ReturnType<typeof useBackgroundTasks>;
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
    /** Sends a message to the chat of the open project. */
    onSendPrompt: (text: string) => void;
    /** Prompts of the turns running in the chat of the open project. */
    runningPrompts: string[];
    /** A Terminal menu choice to carry out (a new object per choice); `isFresh`: the panel was opened by it, so its first terminal is the new one. */
    terminalCommand?: TerminalCommand | null;
    /** Moves the whole panel into a separate window; absent in that window itself (and then the placement menu is hidden too). */
    onDetach?: () => void;
}) {
    const sessions = useTerminalSessions(onClose, root);
    const [doneCommand, setDoneCommand] = useState<TerminalCommand | null>(
        null,
    );

    if (terminalCommand != null && terminalCommand !== doneCommand) {
        setDoneCommand(terminalCommand);

        if (terminalCommand.action === 'split') {
            sessions.divide();
        } else if (!terminalCommand.isFresh) {
            sessions.add();
        }
    }
    const { tasks, failed, stopTask, clearFinished } = background;
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
                className="@container flex h-9 shrink-0 items-center justify-between gap-1 border-b border-zinc-200 px-2 text-xs dark:border-zinc-800"
            >
                <div
                    role="tablist"
                    aria-label={t('bottom_panel.label')}
                    className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] @md:gap-1 [&::-webkit-scrollbar]:hidden"
                >
                    {tabs.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={tab === item.id}
                            onClick={() => onTabChange(item.id)}
                            className={cn(
                                'flex h-full min-w-0 shrink items-center truncate border-b-2 px-1.5 text-zinc-500 @md:px-2 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-zinc-400 dark:hover:text-zinc-100',
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
                    {onDetach !== undefined && (
                        <PanelMenu
                            onOpenWindow={onDetach}
                            placement={placement}
                            dockedPlacement={dockedPlacement}
                            floatable
                            edges={['bottom']}
                            onPlacementChange={onPlacementChange}
                        />
                    )}
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
                    <PlansPane
                        key={root}
                        root={root}
                        onOpenFile={onOpenFile}
                        onSendPrompt={onSendPrompt}
                        runningPrompts={runningPrompts}
                    />
                )}
                {terminalStarted && (
                    <ActivityTerminal
                        sessions={sessions}
                        visible={tab === 'terminal'}
                    />
                )}
            </div>
        </section>
    );
}
