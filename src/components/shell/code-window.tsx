import { Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import { BottomPanel } from '@/components/shell/bottom-panel';
import { useBackgroundTasks } from '@/components/shell/chat/use-background-tasks';
import { Button } from '@/components/ui/button';
import { usePanelPlacement } from '@/hooks/use-panel-placement';
import { ide } from '@/lib/ide';
import { t } from '@/lib/i18n';

const noop = () => undefined;

/** The window once the folder is known: the files and editor with the terminal under them. */
function CodeWindowBody({ root }: { root: string }) {
    const repo = `local:${root}`;
    // * A key of its own (the tree starts on the left here); an older saved choice under the former key does not apply.
    const treePlacement = usePanelPlacement('code-window-tree-left', 'left');
    const background = useBackgroundTasks(root);
    const [terminalOpen, setTerminalOpen] = useState(true);
    const [treeClosed, setTreeClosed] = useState(false);
    const [openRequest, setOpenRequest] = useState<{
        repo: string;
        path: string;
        id: number;
    } | null>(null);

    return (
        <div className="flex h-screen flex-col">
            {/* * There is no chat to take the rest of the width, so the editor column (its empty state too) fills it and the tree keeps its own width. */}
            <div className="flex min-h-0 min-w-0 flex-1 [&>aside]:grow-0 [&>section]:w-auto! [&>section]:flex-1">
                <CodeViewer
                    alwaysShowEditor
                    hasWindowButtons={false}
                    chatCollapsed
                    treeClosed={treeClosed}
                    onTreeClosedChange={setTreeClosed}
                    treePlacement={treePlacement}
                    repo={repo}
                    repos={[repo]}
                    onViewRepo={noop}
                    changes={[]}
                    assistant={{ name: 'Codexis' }}
                    openRequest={openRequest}
                    tabsEnd={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('background_tasks.category_terminal')}
                            title={t('background_tasks.category_terminal')}
                            aria-pressed={terminalOpen}
                            onClick={() => setTerminalOpen((open) => !open)}
                            className="text-muted-foreground"
                        >
                            <Terminal aria-hidden="true" className="size-4" />
                        </Button>
                    }
                />
            </div>
            {terminalOpen && (
                <div className="h-2/5 min-h-40 shrink-0 border-t">
                    <BottomPanel
                        tab="terminal"
                        root={root}
                        background={background}
                        placement="bottom"
                        dockedPlacement="bottom"
                        historyPath={null}
                        onPlacementChange={noop}
                        onClearHistoryPath={noop}
                        onTabChange={noop}
                        onClose={() => setTerminalOpen(false)}
                        onOpenSubagent={noop}
                        onOpenFile={(path) =>
                            setOpenRequest((current) => ({
                                repo,
                                path,
                                id: (current?.id ?? 0) + 1,
                            }))
                        }
                        onSendPrompt={noop}
                        runningPrompts={[]}
                    />
                </div>
            )}
        </div>
    );
}

/** The page of the separate code window: files, editor and terminal of one project, with no chat, sidebar or sign-in check. */
export function CodeWindow() {
    const [root, setRoot] = useState<string | null | undefined>(undefined);

    useEffect(() => {
        void ide
            .terminalWindowRoot()
            .then((folder) => setRoot(folder))
            .catch(() => setRoot(null));
    }, []);

    return root === undefined || root === null ? null : (
        <CodeWindowBody root={root} />
    );
}
