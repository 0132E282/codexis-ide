import {
    ChartColumn,
    EllipsisVertical,
    Folder,
    FolderOpen,
    Plus,
    Settings,
    Smartphone,
    Trash2,
} from 'lucide-react';
import { Fragment, lazy, Suspense, useEffect, useState } from 'react';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import logo from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import { Input } from '@/components/ui/input';
import type { ChatConversation, Project, Subagent } from '@/lib/ide';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

// * Opened rarely: fetched when the browser is idle after first paint (the button shows meanwhile).
const loadNewProjectDialog = () =>
    import('@/components/shell/new-project-dialog').then((module) => ({
        default: module.NewProjectDialog,
    }));
const NewProjectDialog = lazy(loadNewProjectDialog);

/** Lower case without accents, so "du an" finds "Dự án". */
const plain = (text: string) =>
    text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .toLowerCase();

/** Left column: brand, the saved projects (or the start-up folder while there are none) and the account footer. */
export function Sidebar({
    projects,
    activeId,
    startupName,
    selected,
    error,
    onSelect,
    onSelectStartup,
    onCreated,
    onRemove,
    conversations,
    currentConversation,
    subagents,
    onOpenConversation,
    onOpenSubagent,
    onDeleteConversation,
    onNewChat,
    onOpenSettings,
    onOpenUsage,
    onConnectPhone,
}: {
    projects: Project[];
    /** Saved project that is the open workspace, if any. */
    activeId: string | null;
    /** Name of the folder the IDE started in; listed only while there are no saved projects. */
    startupName: string | null;
    selected: boolean;
    error: string | null;
    onSelect: (id: string) => void;
    onSelectStartup: () => void;
    onCreated: (project: Project) => void;
    /** `null` is the startup folder shown while no project is saved: it is only hidden. */
    onRemove: (id: string | null) => void;
    /** Conversations of the open project, the most recently used first. */
    conversations: ChatConversation[];
    /** The conversation shown in the chat; null until it is loaded. */
    currentConversation: number | null;
    /** Sub-agents the AI has started in the shown conversation's running turn. */
    subagents: Subagent[];
    onOpenConversation: (id: number) => void;
    /** Shows what a sub-agent did: its call opens in the chat. */
    onOpenSubagent: (id: string) => void;
    onDeleteConversation: (id: number) => void;
    /** Starts a new conversation with the AI in the open project. */
    onNewChat: () => void;
    /** Opens the chat settings on `tab`. */
    onOpenSettings: (tab: SettingsTab) => void;
    onOpenUsage: () => void;
    /** Opens the dialog that pairs the phone app. */
    onConnectPhone: () => void;
}) {
    const [query, setQuery] = useState('');

    useEffect(() => {
        const timer = window.setTimeout(
            () => void loadNewProjectDialog(),
            1500,
        );

        return () => window.clearTimeout(timer);
    }, []);
    const needle = plain(query.trim());
    const rows: { id: string | null; name: string }[] =
        projects.length > 0
            ? projects
            : startupName !== null
              ? [{ id: null, name: startupName }]
              : [];
    const visible = rows.filter((row) => plain(row.name).includes(needle));

    const newProjectButton = (
        <Button type="button" variant="ghost" size="sm" className="gap-1.5">
            <Plus aria-hidden="true" />
            {t('sidebar.add_new_project')}
        </Button>
    );

    return (
        <aside
            aria-label={t('sidebar.sidebar')}
            className="flex w-full min-w-0 shrink-0 flex-col border-r bg-background"
        >
            {/* * The native window buttons are hidden until the pointer reaches the top-left corner, so the logo sits at the left edge. */}
            <div className="flex h-12 shrink-0 items-center gap-2 pl-4 select-none">
                <img src={logo} alt="" className="size-7" />
                <span className="text-lg font-semibold">Codexis</span>
            </div>
            <div className="flex items-center justify-between px-3 pb-2 text-sm">
                <span className="text-muted-foreground">
                    {t('common.projects')}
                </span>
                <Suspense fallback={newProjectButton}>
                    <NewProjectDialog onCreated={onCreated}>
                        {newProjectButton}
                    </NewProjectDialog>
                </Suspense>
            </div>
            <div className="px-2 pb-2">
                <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setQuery('');
                        }
                    }}
                    aria-label={t('common.search_projects')}
                    placeholder={t('common.search_projects2')}
                />
            </div>
            <nav
                aria-label={t('common.projects')}
                className="min-h-0 flex-1 overflow-y-auto px-1"
            >
                {error !== null && (
                    <p
                        role="alert"
                        className="px-3 py-2 text-sm text-destructive"
                    >
                        {error}
                    </p>
                )}
                {needle === '' && rows.length === 0 && error === null && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                        {t('sidebar.no_projects_yet_choose')}
                    </p>
                )}
                {needle !== '' && visible.length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                        {t('sidebar.no_project_found')}
                    </p>
                )}
                {visible.map((row) => {
                    const active = selected && row.id === activeId;

                    return (
                        <Fragment key={row.id ?? 'startup'}>
                            <div className="group relative">
                                <button
                                    type="button"
                                    aria-current={active}
                                    onClick={() =>
                                        row.id === null
                                            ? onSelectStartup()
                                            : onSelect(row.id)
                                    }
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                        active &&
                                            'bg-accent text-accent-foreground hover:bg-accent',
                                    )}
                                >
                                    {active ? (
                                        <FolderOpen
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                        />
                                    ) : (
                                        <Folder
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                        />
                                    )}
                                    <span className="min-w-0 flex-1 truncate">
                                        {row.name}
                                    </span>
                                    <span
                                        title={t(
                                            'sidebar.number_of_conversations',
                                        )}
                                        className="mr-6 shrink-0 text-xs text-muted-foreground tabular-nums"
                                    >
                                        {active ? conversations.length : ''}
                                    </span>
                                </button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t(
                                        'sidebar.remove_project_name_from',
                                        {
                                            name: row.name,
                                        },
                                    )}
                                    title={t('sidebar.remove_from_list_the')}
                                    onClick={() => onRemove(row.id)}
                                    className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground opacity-50 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                                >
                                    <Trash2 aria-hidden="true" />
                                </Button>
                            </div>
                            {active && (
                                <button
                                    type="button"
                                    onClick={onNewChat}
                                    className="mt-0.5 ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <Plus
                                        aria-hidden="true"
                                        className="size-4"
                                    />
                                    {t('sidebar.new_conversation')}
                                </button>
                            )}
                            {active && (
                                <ul className="ml-5 flex flex-col gap-0.5">
                                    {conversations.map((conversation) => (
                                        <li
                                            key={conversation.id}
                                            className="group/chat relative"
                                        >
                                            <button
                                                type="button"
                                                aria-current={
                                                    conversation.id ===
                                                    currentConversation
                                                }
                                                title={conversation.title}
                                                onClick={() =>
                                                    onOpenConversation(
                                                        conversation.id,
                                                    )
                                                }
                                                className={cn(
                                                    'flex w-full items-center rounded-sm py-1.5 pr-8 pl-2.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                                    conversation.id ===
                                                        currentConversation &&
                                                        'bg-accent/60 text-foreground',
                                                )}
                                            >
                                                <span className="truncate">
                                                    {conversation.title ||
                                                        t(
                                                            'sidebar.conversation',
                                                        )}
                                                </span>
                                            </button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-label={t(
                                                    'sidebar.delete_conversation',
                                                )}
                                                title={t(
                                                    'sidebar.delete_conversation',
                                                )}
                                                onClick={() =>
                                                    onDeleteConversation(
                                                        conversation.id,
                                                    )
                                                }
                                                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-50 group-hover/chat:opacity-100 hover:text-destructive focus-visible:opacity-100"
                                            >
                                                <Trash2 aria-hidden="true" />
                                            </Button>
                                            {conversation.id ===
                                                currentConversation &&
                                                subagents.length > 0 && (
                                                    <ul
                                                        aria-label={t(
                                                            'sidebar.agent_is_working',
                                                        )}
                                                        className="mt-0.5 mb-1 ml-4 flex flex-col gap-0.5 border-l pl-2"
                                                    >
                                                        {subagents.map(
                                                            (agent) => (
                                                                <li
                                                                    key={
                                                                        agent.id
                                                                    }
                                                                >
                                                                    <button
                                                                        type="button"
                                                                        title={
                                                                            agent.label
                                                                        }
                                                                        onClick={() =>
                                                                            onOpenSubagent(
                                                                                agent.id,
                                                                            )
                                                                        }
                                                                        className="flex w-full items-center gap-2 rounded-sm py-0.5 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                                                    >
                                                                        <span
                                                                            aria-hidden="true"
                                                                            className={cn(
                                                                                'size-1.5 shrink-0 rounded-full',
                                                                                agent.done
                                                                                    ? 'bg-muted-foreground/50'
                                                                                    : 'animate-pulse bg-primary',
                                                                            )}
                                                                        />
                                                                        <span className="truncate">
                                                                            {
                                                                                agent.label
                                                                            }
                                                                        </span>
                                                                    </button>
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Fragment>
                    );
                })}
            </nav>
            <div className="flex items-center gap-2 border-t px-3 py-2.5">
                <AssistantAvatar />
                <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm">Rynox</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {t('sidebar.ai_assistant_not_connected')}
                    </p>
                </div>
                <span
                    role="img"
                    aria-label={t('sidebar.ai_assistant_not_connected2')}
                    className="size-2 shrink-0 rounded-full bg-muted-foreground/60"
                />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('common.add')}
                            className="text-muted-foreground"
                        >
                            <EllipsisVertical aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top">
                        <DropdownMenuItem
                            onSelect={() => onOpenSettings('character')}
                        >
                            <Settings aria-hidden="true" />
                            {t('common.chat_settings')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={onOpenUsage}>
                            <ChartColumn aria-hidden="true" />
                            {t('sidebar.statistics')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={onConnectPhone}>
                            <Smartphone aria-hidden="true" />
                            {t('common.connect_phone')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </aside>
    );
}
