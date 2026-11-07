import { Folder, LayoutGrid, Plus, X } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { GridMember, Project } from '@/lib/ide';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** One group of the chat grid: its number, how many chats it holds, and its projects with the titles of their chats. */
export type GridGroup = {
    group: number;
    count: number;
    projects: { root: string; titles: string[] }[];
};

/** The groups, by number; the group new chats go to is always listed (it may still be empty). Each lists its projects in the order they first appear, with the titles of their chats: the sidebar shows these, not every chat. */
export function buildGridGroups(
    grid: GridMember[],
    targetGroup: number,
): GridGroup[] {
    const groupNumbers = [
        ...new Set([...grid.map((member) => member.group), targetGroup]),
    ].sort((first, second) => first - second);

    return groupNumbers.map((group) => ({
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
}

/** The groups of the chat grid with their projects and chat titles, and the "new group" button. */
export function SidebarGridGroups({
    grid,
    gridGroups,
    projects,
    openGroup,
    targetGroup,
    maxGrid,
    onOpenGroup,
    onNewGroup,
    onRemoveGridProject,
}: {
    grid: GridMember[];
    gridGroups: GridGroup[];
    projects: Project[];
    openGroup: number | null;
    targetGroup: number;
    maxGrid: number;
    onOpenGroup: (group: number) => void;
    onNewGroup: () => void;
    onRemoveGridProject: (root: string, group: number) => void;
}) {
    // * Name of the project a grid chat belongs to: the saved project with that folder, else the folder's own name.
    const names = useMemo(
        () =>
            new Map(
                projects.map((project) => [project.folders[0], project.name]),
            ),
        [projects],
    );
    const projectName = (workspace: string) =>
        names.get(workspace) ??
        workspace.split('/').filter(Boolean).pop() ??
        workspace;

    return (
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
                                        position < entry.projects.length - 1 &&
                                        'after:-top-0.5 after:-bottom-0.5',
                                    position > 0 &&
                                        position ===
                                            entry.projects.length - 1 &&
                                        'after:-top-0.5 after:bottom-[calc(100%-0.875rem)]',
                                )}
                            >
                                <button
                                    type="button"
                                    disabled={entry.count < 2}
                                    onClick={() => onOpenGroup(entry.group)}
                                    className="flex w-full items-center gap-2 rounded-sm py-1.5 pr-8 pl-2.5 text-left text-sm text-foreground hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:hover:bg-transparent"
                                >
                                    <Folder
                                        aria-hidden="true"
                                        className="size-4 shrink-0"
                                    />
                                    <span
                                        title={projectName(project.root)}
                                        className="min-w-0 flex-1 truncate"
                                    >
                                        {projectName(project.root)}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                        {project.titles.length}
                                    </span>
                                </button>
                                <ul className="mb-1 flex flex-col pr-2 pl-9">
                                    {project.titles.map((title, titleIndex) => (
                                        <li
                                            key={titleIndex}
                                            title={
                                                title ||
                                                t('sidebar.conversation')
                                            }
                                            className="truncate py-0.5 text-xs text-muted-foreground"
                                        >
                                            {title || t('sidebar.conversation')}
                                        </li>
                                    ))}
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
                disabled={grid.every((member) => member.group !== targetGroup)}
                className="w-full justify-start gap-1.5 text-muted-foreground"
            >
                <Plus aria-hidden="true" />
                {t('sidebar.new_group')}
            </Button>
        </div>
    );
}
