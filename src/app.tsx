import { Code2, Terminal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityTerminal,
    type ActivityEntry,
} from '@/components/ai-chat/activity-terminal';
import { LocalBranchPopover } from '@/components/ai-chat/branch-popover';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { LoginScreen } from '@/components/shell/accounts';
import { ChatPanel } from '@/components/shell/chat-panel';
import { SettingsDialog } from '@/components/shell/settings-dialog';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import { Sidebar } from '@/components/shell/sidebar';
import { UsageDialog } from '@/components/shell/usage-dialog';
import { Button } from '@/components/ui/button';
import { canChat, useAuthStatus } from '@/hooks/use-auth-status';
import { api } from '@/lib/api';
import { errorText, ide, type ChatConversation, type Project } from '@/lib/ide';
import { cn } from '@/lib/utils';

const NOT_AVAILABLE = 'Chưa có trong IDE.';

// * No assistant is wired: the viewer's "Hỏi AI về đoạn này" box opens, and its answer is the honest "not in the IDE" failure of the api stand-in.
const askAssistant = async () =>
    (await api.post<InlineAnswer>('/ai-chat/inline-ask')).data;

export default function App() {
    const [name, setName] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    // * Bumped on every workspace switch: the viewer remounts so tabs and edits of the previous root are dropped.
    const [workspaceKey, setWorkspaceKey] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState(false);
    // * Once a project was picked its viewer stays mounted (hidden), so open tabs and unsaved edits survive the panel toggle.
    const [viewerMounted, setViewerMounted] = useState(false);
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [terminalOpen, setTerminalOpen] = useState(false);
    // * Bumped by "Cuộc trò chuyện mới": the chat panel starts a fresh conversation.
    const [newChat, setNewChat] = useState(0);
    // * Conversations of the open project (listed under it in the sidebar), the one shown, and the one picked there.
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [currentConversation, setCurrentConversation] = useState<
        number | null
    >(null);
    const [pickedConversation, setPickedConversation] = useState<number | null>(
        null,
    );
    const refreshConversations = useCallback(
        () =>
            void ide
                .chatList()
                .then(setConversations)
                .catch(() => undefined),
        [],
    );
    // * Chat settings (the open tab) and the AI statistics, both opened from the sidebar's ⋮ menu.
    const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
    const [usageOpen, setUsageOpen] = useState(false);
    // * Sign-in of the AI CLIs and GitHub: the app stays behind the login screen until one AI CLI is signed in.
    const auth = useAuthStatus(false);
    // * No file and no change list open: the chat takes the room the editor would have.
    const [editorVisible, setEditorVisible] = useState(false);
    const [entries, setEntries] = useState<ActivityEntry[]>([]);
    const entryId = useRef(0);

    // * Files dragged in from outside the app are refused: left alone, the webview would navigate to the dropped file. Drags inside the app (tabs, lists) carry no files and are not touched.
    useEffect(() => {
        const refuse = (event: DragEvent) => {
            if (event.dataTransfer?.types.includes('Files')) {
                event.preventDefault();

                if (event.dataTransfer !== null) {
                    event.dataTransfer.dropEffect = 'none';
                }
            }
        };

        window.addEventListener('dragover', refuse);
        window.addEventListener('drop', refuse);

        return () => {
            window.removeEventListener('dragover', refuse);
            window.removeEventListener('drop', refuse);
        };
    }, []);

    useEffect(() => {
        Promise.all([ide.info(), ide.projects()])
            .then(([info, saved]) => {
                setName(info.name);
                setProjects(saved.projects);
                setActiveId(saved.selected);
                // * Code is the only view: open the workspace right away.
                setSelected(true);
                setViewerMounted(true);
            })
            .catch((caught) => setError(errorText(caught)));
    }, []);

    const select = () => {
        setSelected(true);
        setViewerMounted(true);
    };

    const selectProject = (id: string) =>
        ide
            .selectProject(id)
            .then((info) => {
                setName(info.name);
                setActiveId(id);
                setWorkspaceKey((key) => key + 1);
                setActiveFile(null);
                select();
            })
            .catch((caught) => console.error(errorText(caught)));

    const createdProject = (project: Project) => {
        setProjects((current) => [...current, project]);
        void selectProject(project.id);
    };

    const removeProject = (id: string) =>
        ide
            .removeProject(id)
            .then(() => {
                setProjects((current) =>
                    current.filter((project) => project.id !== id),
                );

                if (id === activeId) {
                    setActiveId(null);
                    setSelected(false);
                    setViewerMounted(false);
                }
            })
            .catch((caught) => console.error(errorText(caught)));

    const openInVscode = () =>
        ide
            .openInVscode(activeFile ?? undefined)
            .catch((caught) => console.error(errorText(caught)));

    // * No shell backend exists: a typed command is echoed like a shell line and answered with the honest "not in the IDE" failure.
    const runCommand = useCallback(async (command: string) => {
        const time = new Date().toLocaleTimeString('vi-VN');

        setEntries((current) => [
            ...current,
            {
                id: entryId.current++,
                time,
                level: 'info',
                text: `$ ${command}`,
            },
            {
                id: entryId.current++,
                time,
                level: 'error',
                text: NOT_AVAILABLE,
            },
        ]);
    }, []);

    const noViewerChange = useCallback(() => undefined, []);
    const showPanel = selected;

    if (auth.statuses === null || !canChat(auth.statuses)) {
        return (
            <LoginScreen
                statuses={auth.statuses}
                error={auth.error}
                onChanged={() => void auth.refresh()}
            />
        );
    }

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background text-sm text-foreground">
            <div className="flex min-h-0 flex-1 overflow-hidden">
                <Sidebar
                    projects={projects}
                    activeId={activeId}
                    startupName={name}
                    selected={selected}
                    error={error}
                    onSelect={(id) => void selectProject(id)}
                    onSelectStartup={select}
                    onCreated={createdProject}
                    onRemove={(id) => void removeProject(id)}
                    conversations={conversations}
                    currentConversation={currentConversation}
                    onOpenConversation={setPickedConversation}
                    onDeleteConversation={(id) =>
                        void ide
                            .chatDelete(id)
                            .then(() => {
                                refreshConversations();

                                if (id === currentConversation) {
                                    setNewChat((count) => count + 1);
                                }
                            })
                            .catch(() => undefined)
                    }
                    onNewChat={() => setNewChat((count) => count + 1)}
                    onOpenSettings={setSettingsTab}
                    onOpenUsage={() => setUsageOpen(true)}
                />
                <main className="flex min-w-0 flex-1 flex-col">
                    {!showPanel && (
                        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                            Chọn một dự án để bắt đầu.
                        </div>
                    )}
                    {viewerMounted && name !== null && (
                        <div
                            className={
                                showPanel
                                    ? 'flex min-h-0 min-w-0 flex-1 flex-col'
                                    : 'hidden'
                            }
                        >
                            <div className="flex min-h-0 flex-1">
                                <ChatPanel
                                    key={workspaceKey}
                                    fill={!editorVisible}
                                    newChat={newChat}
                                    openConversation={pickedConversation}
                                    onConversation={(id) => {
                                        setCurrentConversation(id);
                                        refreshConversations();
                                    }}
                                    onChanged={refreshConversations}
                                />
                                <CodeViewer
                                    key={workspaceKey}
                                    repo={`local:${name}`}
                                    repos={[`local:${name}`]}
                                    onViewRepo={noViewerChange}
                                    changes={[]}
                                    assistant={{ name: 'Rynox' }}
                                    onInlineAsk={askAssistant}
                                    onActiveFile={setActiveFile}
                                    onEditorVisible={setEditorVisible}
                                    headerActions={
                                        <>
                                            <LocalBranchPopover root={name} />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Mở trong VS Code"
                                                title="Mở trong VS Code"
                                                onClick={() =>
                                                    void openInVscode()
                                                }
                                                className="text-muted-foreground"
                                            >
                                                <Code2 aria-hidden="true" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Terminal"
                                                aria-pressed={terminalOpen}
                                                onClick={() =>
                                                    setTerminalOpen(
                                                        (open) => !open,
                                                    )
                                                }
                                                className={cn(
                                                    'text-muted-foreground',
                                                    terminalOpen &&
                                                        'bg-accent text-accent-foreground',
                                                )}
                                            >
                                                <Terminal aria-hidden="true" />
                                            </Button>
                                        </>
                                    }
                                />
                            </div>
                            {terminalOpen && (
                                <div className="h-64 shrink-0 border-t">
                                    <ActivityTerminal
                                        entries={entries}
                                        onClear={() => setEntries([])}
                                        onClose={() => setTerminalOpen(false)}
                                        onRun={runCommand}
                                        name={name}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </main>
                <SettingsDialog
                    tab={settingsTab}
                    onTabChange={setSettingsTab}
                    onClose={() => setSettingsTab(null)}
                />
                <UsageDialog
                    open={usageOpen}
                    onClose={() => setUsageOpen(false)}
                />
            </div>
        </div>
    );
}
