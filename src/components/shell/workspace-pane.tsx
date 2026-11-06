import { Code2, MessageSquare, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { LocalBranchPopover } from '@/components/ai-chat/branch-popover';
import { CodeViewer } from '@/components/ai-chat/code-viewer';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { ChatPanel } from '@/components/shell/chat-panel';
import { Button } from '@/components/ui/button';
import type { Pane, PaneState } from '@/hooks/use-pane-state';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

// * The viewer's "Hỏi AI về đoạn này" box: the Claude CLI answers about the picked lines, run in the project's folder.
const askAssistant =
    (root: string) =>
    async (
        reference: {
            path: string;
            startLine: number;
            endLine: number;
            text: string;
        },
        question: string,
    ) =>
        (
            await api.post<InlineAnswer>('/ai-chat/inline-ask', {
                root,
                ...reference,
                question,
            })
        ).data;

const noViewerChange = () => undefined;

/** The chat and the code viewer of one project. */
export function WorkspacePane({
    pane,
    state,
    active,
    projects,
    terminalOpen,
    sidebarCollapsed,
    sidebarToggle,
    onToggleTerminal,
    onOpenInVscode,
    onPatch,
    onRefreshConversations,
}: {
    pane: Pane;
    state: PaneState;
    /** The pane of the open project: the only one that accepts the phone's messages. */
    active: boolean;
    projects: { root: string; name: string }[];
    terminalOpen: boolean;
    sidebarCollapsed: boolean;
    sidebarToggle: ReactNode;
    onToggleTerminal: () => void;
    onOpenInVscode: () => void;
    onPatch: (key: string, change: Partial<PaneState>) => void;
    onRefreshConversations: (root: string) => void;
}) {
    return (
        <>
            <ChatPanel
                root={pane.root}
                acceptsRemote={active}
                projects={projects}
                fill={!state.editorVisible}
                headerActions={
                    <>
                        <LocalBranchPopover root={pane.root} />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('common.open_in_vs_code')}
                            title={t('common.open_in_vs_code')}
                            onClick={onOpenInVscode}
                            className="text-muted-foreground"
                        >
                            <Code2 aria-hidden="true" className="size-5" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Terminal"
                            aria-pressed={terminalOpen}
                            onClick={onToggleTerminal}
                            className={cn(
                                'text-muted-foreground',
                                terminalOpen &&
                                    'bg-accent text-accent-foreground',
                            )}
                        >
                            <Terminal aria-hidden="true" className="size-5" />
                        </Button>
                        {/* * The sidebar toggle ends this row, on the right. */}
                        {sidebarToggle}
                    </>
                }
                onTooNarrow={() => onPatch(pane.key, { chatCollapsed: true })}
                attachFile={state.attachFile}
                viewSubagent={state.viewSubagent}
                onLeaveSubagent={() =>
                    onPatch(pane.key, { viewSubagent: null })
                }
                collapsed={state.chatCollapsed && state.editorVisible}
                newChat={state.newChat}
                openConversation={state.picked}
                onConversation={(id) => {
                    onPatch(pane.key, { conversation: id });
                    onRefreshConversations(pane.root);
                }}
                onChanged={() => onRefreshConversations(pane.root)}
                onSubagents={(subagents) => onPatch(pane.key, { subagents })}
            />
            <CodeViewer
                chatCollapsed={state.chatCollapsed}
                tabsEnd={
                    state.chatCollapsed ? (
                        <>
                            {sidebarCollapsed && sidebarToggle}
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('workspace_pane.open_chat_panel')}
                                title={t('workspace_pane.open_chat_panel')}
                                onClick={() =>
                                    onPatch(pane.key, { chatCollapsed: false })
                                }
                                className="text-muted-foreground"
                            >
                                <MessageSquare
                                    aria-hidden="true"
                                    className="size-5"
                                />
                            </Button>
                        </>
                    ) : undefined
                }
                onAttachFile={(path) =>
                    onPatch(pane.key, {
                        attachFile: {
                            path,
                            n: (state.attachFile?.n ?? 0) + 1,
                        },
                    })
                }
                repo={`local:${pane.root}`}
                repos={[`local:${pane.root}`]}
                onViewRepo={noViewerChange}
                changes={[]}
                assistant={{ name: 'Rynox' }}
                onInlineAsk={askAssistant(pane.root)}
                onActiveFile={(file) => onPatch(pane.key, { activeFile: file })}
                onEditorVisible={(visible) =>
                    onPatch(pane.key, { editorVisible: visible })
                }
            />
        </>
    );
}
