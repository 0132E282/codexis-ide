import { ChevronDown, Laptop, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { MODES } from '@/components/shell/chat/cli-options';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { AgentCli } from '@/lib/ide';
import { t } from '@/lib/i18n';

/** The row under the message box: the projects the AI works in (this one, and others picked for the chat), the worktree switch and (Claude only) the permission mode and agent team. */
export function ProjectRow({
    busy,
    projectName,
    otherProjects,
    extraRoots,
    onExtraRootsChange,
    worktree,
    onWorktreeChange,
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

    return (
        <div className="mt-1 flex flex-wrap items-center px-2 text-sm">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t('project_row.choose_working_projects')}
                        title={t('project_row.projects_the_ai_works')}
                        className="max-w-full gap-1.5 text-muted-foreground"
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
                        <Input
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
            <label
                title={t('project_row.run_the_ai_on')}
                className="ml-2 flex cursor-pointer items-center gap-1.5 text-muted-foreground"
            >
                <Checkbox
                    checked={worktree}
                    disabled={busy}
                    onCheckedChange={(on) => onWorktreeChange(on === true)}
                />
                Worktree
            </label>
            {cli === 'claude' && (
                <>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                aria-label={t('project_row.choose_mode')}
                                className="ml-1 gap-1.5 text-muted-foreground"
                            >
                                <ShieldCheck aria-hidden="true" />
                                {modeLabel}
                                <ChevronDown aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuRadioGroup
                                value={mode}
                                onValueChange={onModeChange}
                            >
                                {MODES.map((option) => (
                                    <DropdownMenuRadioItem
                                        key={option.value}
                                        value={option.value}
                                        title={t(option.hint)}
                                    >
                                        {t(option.label)}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-pressed={agentTeam}
                        title={t('project_row.enable_agent_team_experimental')}
                        onClick={() => onAgentTeamChange(!agentTeam)}
                        className={`gap-1.5 ${agentTeam ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                    >
                        <Users aria-hidden="true" />
                        Agent team
                    </Button>
                </>
            )}
        </div>
    );
}
