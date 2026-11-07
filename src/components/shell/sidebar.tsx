import {
    ChartColumn,
    EllipsisVertical,
    Folder,
    LayoutGrid,
    X,
    Github,
    FolderOpen,
    Plus,
    Settings,
    Trash2,
} from 'lucide-react';
import {
    Fragment,
    lazy,
    Suspense,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import Field from '@/components/form/field';
import { useAuthStatus } from '@/hooks/use-auth-status';
import type {
    ChatConversation,
    Project,
    Subagent,
    GridMember,
} from '@/lib/ide';
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

/** The GitHub avatar of the signed-in account; the GitHub mark while the account is unknown or the picture cannot be loaded. */
function GithubAvatar({ account }: { account: string | null }) {
    const [failed, setFailed] = useState(false);

    if (account === null || failed) {
        return (
            <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
            >
                <Github className="size-4" />
            </span>
        );
    }

    return (
        <img
            src={`https://github.com/${encodeURIComponent(account)}.png?size=64`}
            alt=""
            aria-hidden="true"
            onError={() => setFailed(true)}
            className="size-7 shrink-0 rounded-full object-cover"
        />
    );
}

/** A line with a label in the middle, between two sections of the sidebar (the group and the projects). */
function SectionDivider({ label }: { label: string }) {
    return (
        <div
            role="separator"
            aria-label={label}
            className="flex items-center gap-2 px-2.5 pt-2 pb-1 text-xs text-muted-foreground select-none"
        >
            <span className="h-px flex-1 bg-border" />
            {label}
            <span className="h-px flex-1 bg-border" />
        </div>
    );
}

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
    activeRoot,
    grid,
    openGroup,
    targetGroup,
    maxGrid,
    onToggleGrid,
    onOpenGroup,
    onNewGroup,
    onRemoveGridProject,
    onNewChat,
    onOpenSettings,
    onOpenUsage,
    toggle,
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
    /** Folder of the open project; null for the start-up folder, whose chats cannot join the grid. */
    activeRoot: string | null;
    /** Chats of the grid, across projects, in grid order (the grid shows from two on). */
    grid: GridMember[];
    /** The group shown in the main area; null when none is. */
    openGroup: number | null;
    /** The group a chat is added to next. */
    targetGroup: number;
    maxGrid: number;
    /** Adds the chat to a group, or takes it out when it is in one. */
    onToggleGrid: (root: string, conversation: number, group: number) => void;
    /** Shows a group (it needs two chats). */
    onOpenGroup: (group: number) => void;
    /** Starts an empty group; the next chats added go to it. */
    onNewGroup: () => void;
    /** Takes every chat of one project out of one group. */
    onRemoveGridProject: (root: string, group: number) => void;
    /** Starts a new conversation with the AI in the open project. */
    onNewChat: () => void;
    /** Opens the chat settings on `tab`. */
    onOpenSettings: (tab: SettingsTab) => void;
    onOpenUsage: () => void;
    /** The button that folds the sidebar away; it ends up at the left edge of the sidebar header. */
    toggle?: ReactNode;
}) {
    const [query, setQuery] = useState('');
    const { statuses } = useAuthStatus(false);
    const github = statuses?.find((status) => status.provider === 'github');

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
    // * The groups, by number; the group new chats go to is always listed (it may still be empty). Each lists its projects in the order they first appear, with the titles of their chats: the sidebar shows these, not every chat.
    const groupNumbers = [
        ...new Set([...grid.map((member) => member.group), targetGroup]),
    ].sort((first, second) => first - second);
    const gridGroups = groupNumbers.map((group) => ({
        group,
        count: grid.filter((member) => member.group === group).length,
        projects: grid
            .filter((member) => member.group === group)
            .reduce<{ root: string; titles: string[] }[]>((entries, member) => {
                const known = entries.find(
                    (entry) => entry.root === member.workspace,
                );

                return known === undefined
                    ? [
                          ...entries,
                          { root: member.workspace, titles: [member.title] },
                      ]
                    : entries.map((entry) =>
                          entry === known
                              ? {
                                    ...entry,
                                    titles: [...entry.titles, member.title],
                                }
                              : entry,
                      );
            }, []),
    }));
    // * Name of the project a grid chat belongs to: the saved project with that folder, else the folder's own name.
    const projectName = (workspace: string) =>
        projects.find((project) => project.folders[0] === workspace)?.name ??
        workspace.split('/').filter(Boolean).pop() ??
        workspace;
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
            {/* * The native window buttons are hidden until the pointer reaches the top-left corner, so the sidebar toggle sits at the left edge. */}
            <div className="mb-2 flex h-12 shrink-0 items-center border-b pl-3 select-none">
                {toggle}
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
                <Field
                    name="sidebar-project-search"
                    autoComplete="off"
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
                {grid.length > 0 && (
                    <SectionDivider label={t('sidebar.group_section')} />
                )}
                {grid.length > 0 && (
                    <div data-testid="sidebar-chat-grid" className="mb-1">
                        {gridGroups.map((entry, index) => (
                            <div
                                key={entry.group}
                                data-testid="sidebar-chat-group"
                                className={cn(
                                    // * One background holds the whole group.
                                    'mb-1.5 rounded-md bg-accent/30 p-1',
                                    entry.group === openGroup &&
                                        'bg-accent/60 ring-1 ring-primary/40',
                                )}
                            >
                                <button
                                    type="button"
                                    aria-pressed={entry.group === openGroup}
                                    disabled={entry.count < 2}
                                    onClick={() => onOpenGroup(entry.group)}
                                    className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs font-medium hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:hover:bg-transparent"
                                >
                                    <LayoutGrid
                                        aria-hidden="true"
                                        className="size-3.5 shrink-0"
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('sidebar.group_section')} {index + 1}
                                    </span>
                                    {entry.group === targetGroup && (
                                        <span
                                            title={t('sidebar.group_target')}
                                            className="size-1.5 shrink-0 rounded-full bg-primary"
                                        />
                                    )}
                                    <span className="shrink-0 text-muted-foreground tabular-nums">
                                        {entry.count}/{maxGrid}
                                    </span>
                                </button>
                                <ul className="flex flex-col gap-0.5">
                                    {entry.projects.map((project, position) => (
                                        <li
                                            key={project.root}
                                            className={cn(
                                                'group/member relative',
                                                // * The line down the left side links the projects of the group: one tick into each row, cut to fit the first, middle and last.
                                                'before:absolute before:top-3.5 before:left-1 before:h-px before:w-1.5 before:bg-primary/60 after:absolute after:left-1 after:w-px after:bg-primary/60',
                                                entry.projects.length === 1 &&
                                                    'after:hidden',
                                                position === 0 &&
                                                    'after:top-3.5 after:-bottom-0.5',
                                                position > 0 &&
                                                    position <
                                                        entry.projects.length -
                                                            1 &&
                                                    'after:-top-0.5 after:-bottom-0.5',
                                                position > 0 &&
                                                    position ===
                                                        entry.projects.length -
                                                            1 &&
                                                    'after:-top-0.5 after:bottom-[calc(100%-0.875rem)]',
                                            )}
                                        >
                                            <button
                                                type="button"
                                                disabled={entry.count < 2}
                                                onClick={() =>
                                                    onOpenGroup(entry.group)
                                                }
                                                className="flex w-full items-center gap-2 rounded-sm py-1.5 pr-8 pl-2.5 text-left text-sm text-foreground hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:hover:bg-transparent"
                                            >
                                                <Folder
                                                    aria-hidden="true"
                                                    className="size-4 shrink-0"
                                                />
                                                <span
                                                    title={projectName(
                                                        project.root,
                                                    )}
                                                    className="min-w-0 flex-1 truncate"
                                                >
                                                    {projectName(project.root)}
                                                </span>
                                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                                    {project.titles.length}
                                                </span>
                                            </button>
                                            <ul className="mb-1 flex flex-col pr-2 pl-9">
                                                {project.titles.map(
                                                    (title, titleIndex) => (
                                                        <li
                                                            key={titleIndex}
                                                            title={
                                                                title ||
                                                                t(
                                                                    'sidebar.conversation',
                                                                )
                                                            }
                                                            className="truncate py-0.5 text-xs text-muted-foreground"
                                                        >
                                                            {title ||
                                                                t(
                                                                    'sidebar.conversation',
                                                                )}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-label={t(
                                                    'sidebar.remove_project_from_grid',
                                                )}
                                                title={t(
                                                    'sidebar.remove_project_from_grid',
                                                )}
                                                onClick={() =>
                                                    onRemoveGridProject(
                                                        project.root,
                                                        entry.group,
                                                    )
                                                }
                                                className="absolute top-3.5 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within/member:opacity-100 group-hover/member:opacity-100 hover:text-destructive focus-visible:opacity-100"
                                            >
                                                <X aria-hidden="true" />
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onNewGroup}
                            disabled={grid.every(
                                (member) => member.group !== targetGroup,
                            )}
                            className="w-full justify-start gap-1.5 text-muted-foreground"
                        >
                            <Plus aria-hidden="true" />
                            {t('sidebar.new_group')}
                        </Button>
                    </div>
                )}
                {grid.length > 0 && visible.length > 0 && (
                    <SectionDivider label={t('common.projects')} />
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
                                    <span
                                        title={row.name}
                                        className="min-w-0 flex-1 truncate"
                                    >
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
                                    {(() => {
                                        const inGrid = (id: number) =>
                                            grid.some(
                                                (member) =>
                                                    member.conversation === id,
                                            );
                                        const renderConversation = (
                                            conversation: (typeof conversations)[number],
                                        ) => (
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
                                                        'flex w-full items-center rounded-sm py-1.5 pr-14 pl-2.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
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
                                                {inGrid(conversation.id) ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        aria-label={t(
                                                            'sidebar.remove_from_grid',
                                                        )}
                                                        title={t(
                                                            'sidebar.remove_from_grid',
                                                        )}
                                                        aria-pressed
                                                        onClick={() => {
                                                            if (
                                                                activeRoot !==
                                                                null
                                                            ) {
                                                                onToggleGrid(
                                                                    activeRoot,
                                                                    conversation.id,
                                                                    targetGroup,
                                                                );
                                                            }
                                                        }}
                                                        className="absolute top-1/2 right-7 -translate-y-1/2 text-foreground opacity-100"
                                                    >
                                                        <LayoutGrid aria-hidden="true" />
                                                    </Button>
                                                ) : (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger
                                                            asChild
                                                        >
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-xs"
                                                                aria-label={t(
                                                                    'sidebar.add_to_grid',
                                                                )}
                                                                title={t(
                                                                    'sidebar.add_to_grid',
                                                                )}
                                                                disabled={
                                                                    activeRoot ===
                                                                    null
                                                                }
                                                                className="absolute top-1/2 right-7 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within/chat:opacity-100 group-hover/chat:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                                            >
                                                                <LayoutGrid aria-hidden="true" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {gridGroups.map(
                                                                (
                                                                    entry,
                                                                    index,
                                                                ) => (
                                                                    <DropdownMenuItem
                                                                        key={
                                                                            entry.group
                                                                        }
                                                                        disabled={
                                                                            entry.count >=
                                                                            maxGrid
                                                                        }
                                                                        onSelect={() => {
                                                                            if (
                                                                                activeRoot !==
                                                                                null
                                                                            ) {
                                                                                onToggleGrid(
                                                                                    activeRoot,
                                                                                    conversation.id,
                                                                                    entry.group,
                                                                                );
                                                                            }
                                                                        }}
                                                                    >
                                                                        <span className="flex-1">
                                                                            {t(
                                                                                'sidebar.group_section',
                                                                            )}{' '}
                                                                            {index +
                                                                                1}
                                                                        </span>
                                                                        <span className="text-xs text-muted-foreground tabular-nums">
                                                                            {
                                                                                entry.count
                                                                            }
                                                                            /
                                                                            {
                                                                                maxGrid
                                                                            }
                                                                        </span>
                                                                    </DropdownMenuItem>
                                                                ),
                                                            )}
                                                            <DropdownMenuItem
                                                                onSelect={() => {
                                                                    if (
                                                                        activeRoot !==
                                                                        null
                                                                    ) {
                                                                        onToggleGrid(
                                                                            activeRoot,
                                                                            conversation.id,
                                                                            Math.max(
                                                                                ...groupNumbers,
                                                                            ) +
                                                                                1,
                                                                        );
                                                                    }
                                                                }}
                                                            >
                                                                <Plus aria-hidden="true" />
                                                                {t(
                                                                    'sidebar.new_group',
                                                                )}
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
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
                                                    className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within/chat:opacity-100 group-hover/chat:opacity-100 hover:text-destructive focus-visible:opacity-100"
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
                                        );
                                        return conversations.map(
                                            (conversation) =>
                                                renderConversation(
                                                    conversation,
                                                ),
                                        );
                                    })()}
                                </ul>
                            )}
                        </Fragment>
                    );
                })}
            </nav>
            <div className="flex items-center gap-2 border-t px-3 py-2.5">
                {github?.loggedIn ? (
                    // * Signed in with GitHub: the footer shows the account's GitHub avatar.
                    <GithubAvatar account={github.account} />
                ) : (
                    <AssistantAvatar />
                )}
                <p className="min-w-0 flex-1 truncate text-sm">
                    {github?.loggedIn
                        ? (github.account ?? t('accounts.signed_in'))
                        : 'Rynox'}
                </p>
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
                        {github?.loggedIn ? (
                            <DropdownMenuItem disabled>
                                <Github aria-hidden="true" />
                                {t('sidebar.github_signed_in', {
                                    account:
                                        github.account ??
                                        t('accounts.signed_in'),
                                })}
                            </DropdownMenuItem>
                        ) : (
                            // * The sign-in itself is the "Kết nối" tab: GitHub's own `gh` login, which shows the one-time code there.
                            <DropdownMenuItem
                                onSelect={() => onOpenSettings('connect')}
                            >
                                <Github aria-hidden="true" />
                                {t('sidebar.sign_in_with_github')}
                            </DropdownMenuItem>
                        )}
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
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </aside>
    );
}
