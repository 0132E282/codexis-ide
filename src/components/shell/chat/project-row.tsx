import {
    Check,
    ChevronDown,
    CircleHelp,
    FilePen,
    GitBranch,
    Laptop,
    ListChecks,
    ShieldOff,
    Zap,
    type LucideIcon,
    Settings2,
    ShieldCheck,
    Users,
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { MODES } from '@/components/shell/chat/cli-options';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Field from '@/components/form/field';
import { useConfirm } from '@/hooks/use-confirm';
import type { AgentCli } from '@/lib/ide';
import { t } from '@/lib/i18n';

// * An icon for each permission mode in the Settings menu.
const MODE_ICONS: Record<string, LucideIcon> = {
    auto: Zap,
    manual: CircleHelp,
    acceptEdits: FilePen,
    plan: ListChecks,
    bypassPermissions: ShieldOff,
};

/** The row under the message box: the projects the AI works in (this one, and others picked for the chat), the worktree switch and (Claude only) the permission mode and agent team. */
export function ProjectRow({
    busy,
    projectName,
    otherProjects,
    extraRoots,
    onExtraRootsChange,
    worktree,
    onWorktreeChange,
    showWorktree = true,
    compact = false,
    cli,
    mode,
    onModeChange,
    agentTeam,
    onAgentTeamChange,
}: {
    busy: boolean;
    /** Name of the project this chat belongs to. */
    projectName: string;
    /** Saved projects other than the one this chat belongs to. */
    otherProjects: { root: string; name: string }[];
    /** Folders of the other projects the AI may also work in. */
    extraRoots: string[];
    onExtraRootsChange: (roots: string[]) => void;
    /** Worktree mode: the AI works on its own git branch, in a copy of the project. */
    worktree: boolean;
    onWorktreeChange: (on: boolean) => void;
    /** False in the chat grid, where each project has its own Worktree switch on its bar. */
    showWorktree?: boolean;
    /** One "Settings" menu holds Worktree, the permission mode and agent team, so the row stays short (every chat). */
    compact?: boolean;
    cli: AgentCli;
    mode: string;
    onModeChange: (mode: string) => void;
    agentTeam: boolean;
    onAgentTeamChange: (on: boolean) => void;
}) {
    const modeLabel = t(
        MODES.find((option) => option.value === mode)?.label ?? mode,
    );
    const [projectSearch, setProjectSearch] = useState('');
    const { confirm, dialog } = useConfirm();
    const [modeMenuOpen, setModeMenuOpen] = useState(false);
    const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

    // * A mode that accepts every permission is used only after the person confirms, every time it is picked.
    const chooseMode = async (next: string) => {
        if (next === mode) {
            return;
        }

        if (
            MODES.find((option) => option.value === next)?.dangerous === true &&
            !(await confirm({
                title: t('project_row.bypass_title'),
                description: t('project_row.bypass_description'),
                action: t('project_row.bypass_action'),
            }))
        ) {
            return;
        }

        onModeChange(next);
    };

    // * The number on each row picks it.
    const pickModeByNumber = (
        event: KeyboardEvent<HTMLElement>,
        closeMenu: () => void,
    ) => {
        const picked = MODES[Number(event.key) - 1];

        if (picked !== undefined) {
            event.preventDefault();
            // * The menu closes first, so the confirmation is not drawn over an open menu.
            closeMenu();
            void chooseMode(picked.value);
        }
    };

    // * Every mode with its hint, the Recommended tag, its number and a ✓ on the current one (the Settings menu and the mode menu share it).
    const modeItems = MODES.map((option, index) => {
        const Icon = MODE_ICONS[option.value];

        return (
            <DropdownMenuItem
                key={option.value}
                role="menuitemradio"
                aria-checked={option.value === mode}
                onSelect={() => void chooseMode(option.value)}
            >
                {Icon === undefined ? null : <Icon aria-hidden="true" />}
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                        {t(option.label)}
                        {option.recommended && (
                            <span className="rounded-full border px-1.5 text-xs text-muted-foreground">
                                {t('cli_options.recommended')}
                            </span>
                        )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {t(option.hint)}
                    </span>
                </span>
                {option.value === mode && <Check aria-hidden="true" />}
                <DropdownMenuShortcut>{index + 1}</DropdownMenuShortcut>
            </DropdownMenuItem>
        );
    });

    return (
        <div
            className={`${compact ? '@container min-w-0 flex-1 flex-nowrap' : 'mt-1 flex-wrap'} flex items-center px-2 text-sm`}
        >
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t('project_row.choose_working_projects')}
                        title={t('project_row.projects_the_ai_works')}
                        className={`min-w-0 max-w-full gap-1.5 text-muted-foreground ${compact ? 'shrink' : ''}`}
                    >
                        <Laptop aria-hidden="true" />
                        <span className="truncate">
                            {projectName}
                            {extraRoots.length > 0
                                ? ` +${extraRoots.length}`
                                : ''}
                        </span>
                        <ChevronDown aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    className="w-64"
                    onCloseAutoFocus={() => setProjectSearch('')}
                >
                    <div className="p-1">
                        <Field
                            name="project-row-search"
                            autoComplete="off"
                            value={projectSearch}
                            onChange={(event) =>
                                setProjectSearch(event.target.value)
                            }
                            onKeyDown={(event) => event.stopPropagation()}
                            aria-label={t('common.search_projects')}
                            placeholder={t('common.search_projects2')}
                        />
                    </div>
                    <DropdownMenuCheckboxItem checked disabled>
                        {projectName}
                    </DropdownMenuCheckboxItem>
                    {otherProjects.length === 0 && (
                        <DropdownMenuItem disabled>
                            {t('project_row.no_other_projects_yet')}
                        </DropdownMenuItem>
                    )}
                    {otherProjects
                        .filter((other) =>
                            other.name
                                .toLowerCase()
                                .includes(projectSearch.trim().toLowerCase()),
                        )
                        .map((other) => (
                            <DropdownMenuCheckboxItem
                                key={other.root}
                                checked={extraRoots.includes(other.root)}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(on) =>
                                    onExtraRootsChange(
                                        on
                                            ? [...extraRoots, other.root]
                                            : extraRoots.filter(
                                                  (root) => root !== other.root,
                                              ),
                                    )
                                }
                            >
                                {other.name}
                            </DropdownMenuCheckboxItem>
                        ))}
                </DropdownMenuContent>
            </DropdownMenu>
            {compact ? (
                <DropdownMenu
                    open={settingsMenuOpen}
                    onOpenChange={setSettingsMenuOpen}
                >
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={t('project_row.settings')}
                            title={t('project_row.settings')}
                            className="ml-1 shrink-0 gap-1.5 text-muted-foreground"
                        >
                            <Settings2 aria-hidden="true" />
                            {/* * The label gives way to the icon when the bar is narrow (a narrow chat or a chat of the grid). */}
                            <span className="hidden @[22rem]:inline">
                                {t('project_row.settings')}
                            </span>
                            {(worktree || agentTeam) && (
                                <span
                                    aria-hidden="true"
                                    className="size-1.5 rounded-full bg-primary"
                                />
                            )}
                            <ChevronDown aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="w-72"
                        onKeyDown={(event) =>
                            cli === 'claude' &&
                            pickModeByNumber(event, () =>
                                setSettingsMenuOpen(false),
                            )
                        }
                    >
                        {showWorktree && (
                            <DropdownMenuCheckboxItem
                                checked={worktree}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(on) =>
                                    onWorktreeChange(on === true)
                                }
                                title={t('project_row.run_the_ai_on')}
                            >
                                <GitBranch aria-hidden="true" />
                                Worktree
                            </DropdownMenuCheckboxItem>
                        )}
                        {cli === 'claude' && (
                            <>
                                <DropdownMenuCheckboxItem
                                    checked={agentTeam}
                                    onSelect={(event) => event.preventDefault()}
                                    onCheckedChange={(on) =>
                                        onAgentTeamChange(on === true)
                                    }
                                    title={t(
                                        'project_row.enable_agent_team_experimental',
                                    )}
                                >
                                    <Users aria-hidden="true" />
                                    Agent team
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>
                                    {t('project_row.choose_mode')}
                                </DropdownMenuLabel>
                                {modeItems}
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : (
                <>
                    {showWorktree && (
                        <label
                            title={t('project_row.run_the_ai_on')}
                            className="ml-2 flex cursor-pointer items-center gap-1.5 text-muted-foreground"
                        >
                            <Checkbox
                                checked={worktree}
                                disabled={busy}
                                onCheckedChange={(on) =>
                                    onWorktreeChange(on === true)
                                }
                            />
                            Worktree
                        </label>
                    )}
                    {cli === 'claude' && (
                        <>
                            <DropdownMenu
                                open={modeMenuOpen}
                                onOpenChange={setModeMenuOpen}
                            >
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy}
                                        aria-label={t(
                                            'project_row.choose_mode',
                                        )}
                                        className="ml-1 gap-1.5 text-muted-foreground"
                                    >
                                        <ShieldCheck aria-hidden="true" />
                                        {modeLabel}
                                        <ChevronDown aria-hidden="true" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="start"
                                    onKeyDown={(event) =>
                                        pickModeByNumber(event, () =>
                                            setModeMenuOpen(false),
                                        )
                                    }
                                >
                                    {modeItems}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                aria-pressed={agentTeam}
                                title={t(
                                    'project_row.enable_agent_team_experimental',
                                )}
                                onClick={() => onAgentTeamChange(!agentTeam)}
                                className={`gap-1.5 ${agentTeam ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                            >
                                <Users aria-hidden="true" />
                                Agent team
                            </Button>
                        </>
                    )}
                </>
            )}
            {dialog}
        </div>
    );
}
