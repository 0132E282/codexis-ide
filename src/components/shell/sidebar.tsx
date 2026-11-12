import { Folder, FolderOpen, Plus, Trash2 } from 'lucide-react';
import {
    Fragment,
    lazy,
    Suspense,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { SidebarConversationItem } from '@/components/shell/sidebar-conversation-item';
import { SidebarFooter } from '@/components/shell/sidebar-footer';
import {
    SidebarGridGroups,
    buildGridGroups,
} from '@/components/shell/sidebar-grid-groups';
import { Button } from '@/components/ui/button';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import Field from '@/components/form/field';
import { useAuthStatus } from '@/hooks/use-auth-status';
import type { ChatConversation, Project, GridMember } from '@/lib/ide';
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
    onOpenConversation,
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
    hasWindowButtons = true,
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
    onOpenConversation: (id: number) => void;
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
    onOpenGroup: (group: number, root?: string) => void;
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
    /** True while the native window buttons sit at the top-left (every case but fullscreen); the header then leaves room for them. */
    hasWindowButtons?: boolean;
}) {
    const [query, setQuery] = useState('');
    // * The project whose conversations the person folded by clicking it again; undefined: none (null is the start-up folder).
    const [foldedId, setFoldedId] = useState<string | null | undefined>(
        undefined,
    );
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
    // * The groups of the chat grid and the chats in it, worked out again only when the grid changes.
    const gridGroups = useMemo(
        () => buildGridGroups(grid, targetGroup),
        [grid, targetGroup],
    );
    const gridConversations = useMemo(
        () => new Set(grid.map((member) => member.conversation)),
        [grid],
    );
    const nextGroup = Math.max(...gridGroups.map((entry) => entry.group)) + 1;
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
            {/* * The native window buttons are always shown at the top-left, so the sidebar toggle starts after them. */}
            <div
                className={cn(
                    'mb-2 flex h-12 shrink-0 items-center border-b select-none',
                    hasWindowButtons ? 'pl-20' : 'pl-3',
                )}
            >
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
                    <SidebarGridGroups
                        grid={grid}
                        gridGroups={gridGroups}
                        projects={projects}
                        openGroup={openGroup}
                        targetGroup={targetGroup}
                        maxGrid={maxGrid}
                        onOpenGroup={onOpenGroup}
                        onNewGroup={onNewGroup}
                        onRemoveGridProject={onRemoveGridProject}
                    />
                )}
                {grid.length > 0 && visible.length > 0 && (
                    <SectionDivider label={t('common.projects')} />
                )}
                {visible.map((row) => {
                    const active = selected && row.id === activeId;
                    const folded = foldedId === row.id;

                    return (
                        <Fragment key={row.id ?? 'startup'}>
                            <div className="group relative">
                                <button
                                    type="button"
                                    aria-current={active}
                                    aria-expanded={active ? !folded : undefined}
                                    onClick={() => {
                                        // * Clicking the open project again folds or unfolds its conversations.
                                        if (active) {
                                            setFoldedId(
                                                folded ? undefined : row.id,
                                            );

                                            return;
                                        }

                                        setFoldedId(undefined);

                                        if (row.id === null) {
                                            onSelectStartup();
                                        } else {
                                            onSelect(row.id);
                                        }
                                    }}
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
                                <div
                                    inert={folded}
                                    className={cn(
                                        // * The conversations stay mounted so folding can slide them shut: the row height eases between 0 and its content.
                                        'animate-in fade-in slide-in-from-top-2 grid duration-200 ease-out motion-reduce:animate-none motion-reduce:transition-none',
                                        'transition-[grid-template-rows,opacity]',
                                        folded
                                            ? 'grid-rows-[0fr] opacity-0'
                                            : 'grid-rows-[1fr] opacity-100',
                                    )}
                                >
                                    <div className="min-h-0 overflow-hidden">
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
                                        <ul className="ml-5 flex flex-col gap-0.5">
                                            {conversations.map(
                                                (conversation) => (
                                                    <SidebarConversationItem
                                                        key={conversation.id}
                                                        conversation={
                                                            conversation
                                                        }
                                                        isCurrent={
                                                            conversation.id ===
                                                            currentConversation
                                                        }
                                                        inGrid={gridConversations.has(
                                                            conversation.id,
                                                        )}
                                                        activeRoot={activeRoot}
                                                        targetGroup={
                                                            targetGroup
                                                        }
                                                        maxGrid={maxGrid}
                                                        gridGroups={gridGroups}
                                                        nextGroup={nextGroup}
                                                        onOpenConversation={
                                                            onOpenConversation
                                                        }
                                                        onDeleteConversation={
                                                            onDeleteConversation
                                                        }
                                                        onToggleGrid={
                                                            onToggleGrid
                                                        }
                                                    />
                                                ),
                                            )}
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </Fragment>
                    );
                })}
            </nav>
            <SidebarFooter
                github={github}
                onOpenSettings={onOpenSettings}
                onOpenUsage={onOpenUsage}
            />
        </aside>
    );
}
