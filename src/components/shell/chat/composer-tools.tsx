import {
    ChevronDown,
    Plus,
    ShieldCheck,
    Users,
    WandSparkles,
} from 'lucide-react';
import { MODES } from '@/components/shell/chat/cli-options';
import { NOT_AVAILABLE } from '@/components/shell/chat/inert-button';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AgentCli } from '@/lib/ide';

function ModeItems({
    mode,
    onModeChange,
}: {
    mode: string;
    onModeChange: (mode: string) => void;
}) {
    return (
        <DropdownMenuRadioGroup value={mode} onValueChange={onModeChange}>
            {MODES.map((option) => (
                <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    title={option.hint}
                >
                    {option.label}
                </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
    );
}

/** The buttons at the left of the message box: add files, optimise, and (Claude only) the permission mode and agent team. A narrow box folds them into one "+" menu. */
export function ComposerTools({
    busy,
    cli,
    mode,
    onModeChange,
    agentTeam,
    onAgentTeamChange,
    onAddFiles,
}: {
    busy: boolean;
    cli: AgentCli;
    mode: string;
    onModeChange: (mode: string) => void;
    agentTeam: boolean;
    onAgentTeamChange: (on: boolean) => void;
    onAddFiles: () => void;
}) {
    const modeLabel =
        MODES.find((option) => option.value === mode)?.label ?? mode;

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label="Thêm tệp"
                title="Thêm tệp vào tin nhắn"
                onClick={onAddFiles}
                className="hidden text-muted-foreground @xl:inline-flex"
            >
                <Plus aria-hidden="true" />
            </Button>
            {/* * Narrow box: the buttons below fold into this "+" menu. */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label="Thêm"
                        className="text-muted-foreground @xl:hidden"
                    >
                        <Plus aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={onAddFiles}>
                        <Plus aria-hidden="true" />
                        Thêm tệp
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>
                        <WandSparkles aria-hidden="true" />
                        Tối ưu
                    </DropdownMenuItem>
                    {cli === 'claude' && (
                        <>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <ShieldCheck aria-hidden="true" />
                                    {modeLabel}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                    <ModeItems
                                        mode={mode}
                                        onModeChange={onModeChange}
                                    />
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuCheckboxItem
                                checked={agentTeam}
                                onCheckedChange={onAgentTeamChange}
                            >
                                Agent team
                            </DropdownMenuCheckboxItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <span className="hidden items-center gap-1 @xl:flex">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled
                    title={NOT_AVAILABLE}
                    className="gap-1.5 text-muted-foreground"
                >
                    <WandSparkles aria-hidden="true" />
                    Tối ưu
                </Button>
                {cli === 'claude' && (
                    <>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    aria-label="Chọn chế độ"
                                    className="gap-1.5 text-muted-foreground"
                                >
                                    <ShieldCheck aria-hidden="true" />
                                    {modeLabel}
                                    <ChevronDown aria-hidden="true" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <ModeItems
                                    mode={mode}
                                    onModeChange={onModeChange}
                                />
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-pressed={agentTeam}
                            title="Bật agent team (tính năng thử nghiệm của Claude)"
                            onClick={() => onAgentTeamChange(!agentTeam)}
                            className={`gap-1.5 ${agentTeam ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                        >
                            <Users aria-hidden="true" />
                            Agent team
                        </Button>
                    </>
                )}
            </span>
        </>
    );
}
