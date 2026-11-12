import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { BottomPanel } from '@/components/shell/bottom-panel';
import type { BottomTab } from '@/components/shell/bottom-panel';
import { useBackgroundTasks } from '@/components/shell/chat/use-background-tasks';
import { emitBottomAction, ide, onBottomState } from '@/lib/ide';

const TABS: BottomTab[] = [
    'background',
    'terminal',
    'history',
    'plans',
    'data',
];

/** Closes this window: its shells end with it (the backend closes them when the window is destroyed). */
const closeWindow = () => void getCurrentWindow().close();

const noop = () => undefined;

/** The tab the window was opened on (`?tab=`). */
function initialTab(): BottomTab {
    const asked = new URLSearchParams(window.location.search).get('tab');

    return TABS.find((tab) => tab === asked) ?? 'terminal';
}

/** The panel once the folder is known. Background tasks, plans and data are read from the backend (the same source as the main window); what needs the chats or the editor is sent to the main window. */
function BottomWindowBody({ root }: { root: string | undefined }) {
    const [tab, setTab] = useState<BottomTab>(initialTab);
    const [runningPrompts, setRunningPrompts] = useState<string[]>([]);
    const background = useBackgroundTasks(root);

    useEffect(() => {
        const stop = onBottomState((state) =>
            setRunningPrompts(state.runningPrompts),
        );

        // * Listening first, then asking: the main window answers with the prompts running now.
        void stop.then(() => emitBottomAction({ kind: 'ready' }));

        return () => void stop.then((unlisten) => unlisten());
    }, []);

    return (
        <div className="h-screen">
            <BottomPanel
                tab={tab}
                root={root}
                background={background}
                placement="bottom"
                dockedPlacement="bottom"
                historyPath={null}
                onPlacementChange={noop}
                onClearHistoryPath={noop}
                onTabChange={setTab}
                onClose={closeWindow}
                onOpenSubagent={(id) =>
                    void emitBottomAction({ kind: 'open-subagent', id })
                }
                onOpenFile={(path) =>
                    void emitBottomAction({ kind: 'open-file', path })
                }
                onSendPrompt={(text) =>
                    void emitBottomAction({ kind: 'send-prompt', text })
                }
                runningPrompts={runningPrompts}
            />
        </div>
    );
}

/** The page of the separate window: the whole bottom panel, in the project folder the window was opened for. */
export function TerminalWindow() {
    const [folder, setFolder] = useState<{ root: string | undefined } | null>(
        null,
    );

    useEffect(() => {
        void ide
            .terminalWindowRoot()
            .then((root) => setFolder({ root: root ?? undefined }))
            .catch(() => setFolder({ root: undefined }));
    }, []);

    return folder === null ? null : <BottomWindowBody root={folder.root} />;
}
