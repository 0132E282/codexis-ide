import {
    ArrowUp,
    ChevronDown,
    FileText,
    Folder,
    Mic,
    Plus,
    ShieldCheck,
    Users,
    Volume2,
    WandSparkles,
    X,
} from 'lucide-react';
import { referenceForPaste } from '@/lib/editor-copy';
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type ReactNode,
} from 'react';
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
import { ClaudeIcon, CodexIcon } from '@/icons';
import type { AgentCli } from '@/lib/ide';
import { ideTools, type ToolEntry } from '@/lib/ide-tools';

// * Just the brand icon, with no tile behind it.
const CLI_ICONS = { claude: ClaudeIcon, codex: CodexIcon };

const CLIS: { value: AgentCli; label: string; vendor: string }[] = [
    { value: 'claude', label: 'Claude', vendor: 'anthropic' },
    { value: 'codex', label: 'ChatGPT', vendor: 'openai' },
];

// * Fixed lists: they name aliases / models each CLI accepts for `--model` / `-m`; null is the CLI's own default.
const MODELS: Record<AgentCli, { value: string | null; label: string }[]> = {
    claude: [
        { value: null, label: 'Mặc định' },
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'opus', label: 'Opus' },
        { value: 'haiku', label: 'Haiku' },
    ],
    codex: [
        { value: null, label: 'Mặc định' },
        { value: 'gpt-5', label: 'GPT-5' },
        { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
    ],
};

// * Permission modes of the Claude CLI (`--permission-mode`); "auto" is the one the chat starts with.
export const MODES: { value: string; label: string; hint: string }[] = [
    { value: 'plan', label: 'Plan', hint: 'Chỉ lập kế hoạch, không sửa file' },
    { value: 'auto', label: 'Auto', hint: 'Tự duyệt các thao tác an toàn' },
    {
        value: 'acceptEdits',
        label: 'Tự sửa file',
        hint: 'Tự chấp nhận mọi lần sửa file',
    },
    { value: 'manual', label: 'Hỏi từng việc', hint: 'Hỏi trước mỗi thao tác' },
];

const MAX_SUGGESTIONS = 8;

/** The same skill or agent can be found in several folders (user, project, linked copies): the list keeps the first of each name. */
function firstOfEachName(entries: ToolEntry[]): ToolEntry[] {
    const seen = new Set<string>();

    return entries.filter((entry) => {
        const key = entry.name.toLowerCase();

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}
// * Height of one menu item in pixels: the model list opens upward, its last item level with the AI it belongs to.
const MENU_ITEM_HEIGHT = 32;

/** A pasted image or file waiting to be sent with the message. */
export type Attachment = {
    id: string;
    name: string;
    /** Where it was saved: sent to the CLI as `@path`. */
    path: string;
    /** Object URL of an image's thumbnail (null for other files). */
    preview: string | null;
};

const PATH_START = /^\/(Users|Volumes|home|private|tmp|opt|var|Applications)\//;

/** Absolute paths (or `file://` links) pasted as text, one per line; empty unless every line is one. */
export function pastedPaths(text: string): string[] {
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    const paths = lines.map((line) =>
        line.startsWith('file://')
            ? decodeURIComponent(line.slice('file://'.length))
            : line,
    );

    return paths.length > 0 && paths.every((path) => PATH_START.test(path))
        ? paths
        : [];
}

const NOT_AVAILABLE = 'Chưa có trong IDE: chưa có trợ lý AI.';

function Inert({
    label,
    className,
    children,
}: {
    label: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled
            aria-label={label}
            title={NOT_AVAILABLE}
            className={className}
        >
            {children}
        </Button>
    );
}

/** Message box of the chat. Typing, picking the CLI and sending work; attachments, optimise, read aloud and recording are shown but disabled. */
export function Composer({
    project,
    onClearProject,
    value,
    onChange,
    onSubmit,
    busy,
    cli,
    model,
    onChoose,
    mode,
    onModeChange,
    agentTeam,
    onAgentTeamChange,
    onAddFiles,
    attachments,
    attachError,
    onPasteFiles,
    onPastePaths,
    onRemoveAttachment,
}: {
    /** Name of the project the conversation is attached to (null: none). */
    project: string | null;
    onClearProject: () => void;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** A turn is running: sending and switching CLI wait for it. */
    busy: boolean;
    cli: AgentCli;
    /** Model of the chosen CLI (null: its default). */
    model: string | null;
    /** Permission mode of the Claude CLI. */
    mode: string;
    onModeChange: (mode: string) => void;
    /** The Claude CLI's experimental agent teams are on. */
    agentTeam: boolean;
    onAgentTeamChange: (on: boolean) => void;
    /** A model picked under one of the CLIs: picks that CLI and that model together. */
    onChoose: (cli: AgentCli, model: string | null) => void;
    /** * The "+" button: the host lets the person pick files to add to the message. */
    onAddFiles: () => void;
    attachments: Attachment[];
    /** Why the last pasted item was refused (null: none). */
    attachError: string | null;
    /** Images or files pasted into the box. */
    onPasteFiles: (files: File[]) => void;
    /** Paths of files on disk pasted as text. */
    onPastePaths: (paths: string[]) => void;
    onRemoveAttachment: (id: string) => void;
}) {
    const submit = (event: FormEvent) => {
        event.preventDefault();

        if ((value.trim() !== '' || attachments.length > 0) && !busy) {
            onSubmit();
        }
    };
    const [skills, setSkills] = useState<ToolEntry[]>([]);
    const [agents, setAgents] = useState<ToolEntry[]>([]);
    const [activeSuggestion, setActiveSuggestion] = useState(0);
    const [dismissed, setDismissed] = useState(false);

    // * "/" lists the skills and custom commands of this machine and project; read once.
    useEffect(() => {
        ideTools
            .skills()
            .then((listing) => setSkills(firstOfEachName(listing.items)))
            .catch(() => undefined);
        // * "@" lists the sub-agents of this machine and project.
        ideTools
            .agents()
            .then((listing) => setAgents(firstOfEachName(listing.items)))
            .catch(() => undefined);
    }, []);

    // * The list shows while the message is just "/" and the start of a name.
    const query = /^\/(\S*)$/.exec(value)?.[1].toLowerCase() ?? null;
    // * "@" and the start of a name at the end of the message (after a space or at the start) lists the sub-agents.
    const mention = /(?:^|\s)@([\w-]*)$/.exec(value)?.[1].toLowerCase() ?? null;
    const prefix = query !== null ? '/' : '@';
    const suggestions = useMemo(() => {
        const source = query !== null ? skills : mention !== null ? agents : [];
        const needle = query ?? mention;

        return needle === null
            ? []
            : source
                  .filter((entry) => entry.name.toLowerCase().includes(needle))
                  .slice(0, MAX_SUGGESTIONS);
    }, [skills, agents, query, mention]);
    const menuOpen = suggestions.length > 0 && !dismissed;
    const pick = (entry: ToolEntry) => {
        onChange(
            query !== null
                ? `/${entry.name} `
                : value.replace(/@([\w-]*)$/, `@agent-${entry.name} `),
        );
        setActiveSuggestion(0);
    };
    const selected = CLIS.find((option) => option.value === cli) ?? CLIS[0];
    const CliIcon = CLI_ICONS[selected.value];
    const input = useRef<HTMLTextAreaElement>(null);

    return (
        <form
            onSubmit={submit}
            className="mx-auto w-[min(100%-2rem,48rem)] pb-4"
        >
            {project !== null && (
                <div className="mb-2 flex items-center gap-2">
                    <>
                        <span className="flex h-9 items-center gap-2 rounded-md bg-card px-3 text-sm">
                            <Folder
                                aria-hidden="true"
                                className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{project}</span>
                            <button
                                type="button"
                                aria-label="Bỏ chọn dự án"
                                onClick={onClearProject}
                                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                <X aria-hidden="true" className="size-3.5" />
                            </button>
                        </span>
                        <Inert
                            label="Thêm dự án"
                            className="text-muted-foreground"
                        >
                            <Plus aria-hidden="true" />
                        </Inert>
                    </>
                </div>
            )}
            <div
                className="relative @container cursor-text rounded-md border bg-card p-3"
                onMouseDown={(event) => {
                    // * A click on the empty parts of the box (not a button or the text itself) lands in the message field.
                    if (
                        event.target === event.currentTarget ||
                        (event.target instanceof HTMLElement &&
                            event.target.dataset.focusInput !== undefined)
                    ) {
                        event.preventDefault();
                        input.current?.focus();
                    }
                }}
            >
                {attachments.length > 0 && (
                    <ul className="mb-2 flex flex-wrap gap-2">
                        {attachments.map((attachment) => (
                            <li
                                key={attachment.id}
                                title={attachment.name}
                                className="relative size-20 overflow-hidden rounded-md border bg-background"
                            >
                                {attachment.preview !== null ? (
                                    <img
                                        src={attachment.preview}
                                        alt={attachment.name}
                                        className="size-full object-cover"
                                    />
                                ) : (
                                    <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-xs text-muted-foreground">
                                        <FileText
                                            aria-hidden="true"
                                            className="size-6"
                                        />
                                        <span className="w-full truncate text-center">
                                            {attachment.name}
                                        </span>
                                    </span>
                                )}
                                <button
                                    type="button"
                                    aria-label={`Bỏ ${attachment.name}`}
                                    onClick={() =>
                                        onRemoveAttachment(attachment.id)
                                    }
                                    className="absolute top-1 right-1 rounded-sm bg-background/80 p-0.5 text-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <X
                                        aria-hidden="true"
                                        className="size-3.5"
                                    />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {attachError !== null && (
                    <p role="alert" className="mb-2 text-xs text-destructive">
                        {attachError}
                    </p>
                )}
                {menuOpen && (
                    <ul
                        role="listbox"
                        aria-label="Lệnh"
                        className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md"
                    >
                        {suggestions.map((skill, index) => (
                            <li
                                key={`${skill.scope}-${skill.name}`}
                                role="option"
                                aria-selected={index === activeSuggestion}
                            >
                                <button
                                    type="button"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        pick(skill);
                                    }}
                                    className={`flex w-full flex-col rounded-sm px-2 py-1.5 text-left ${index === activeSuggestion ? 'bg-accent' : 'hover:bg-accent/60'}`}
                                >
                                    <span className="font-medium">
                                        {prefix}
                                        {prefix === '@' ? 'agent-' : ''}
                                        {skill.name}
                                    </span>
                                    {skill.description !== '' && (
                                        <span className="truncate text-xs text-muted-foreground">
                                            {skill.description}
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <textarea
                    ref={input}
                    value={value}
                    onChange={(event) => {
                        onChange(event.target.value);
                        setActiveSuggestion(0);
                        setDismissed(false);
                    }}
                    onPaste={(event) => {
                        const { clipboardData } = event;
                        // * Some webviews list a pasted file only under `items`, not `files`.
                        const files =
                            clipboardData.files.length > 0
                                ? Array.from(clipboardData.files)
                                : Array.from(clipboardData.items)
                                      .filter((item) => item.kind === 'file')
                                      .map((item) => item.getAsFile())
                                      .filter((file) => file !== null);
                        const pastedText = clipboardData.getData('text/plain');
                        const paths = pastedPaths(pastedText);
                        const reference = referenceForPaste(pastedText);

                        // * Pasted images and files become attachments; so do pasted paths of files on disk (Finder's "Copy as Pathname"). Other text pastes as usual.
                        if (files.length > 0) {
                            event.preventDefault();
                            onPasteFiles(files);
                        } else if (reference !== null) {
                            // * Code copied from the editor goes in as `file:lines`: the AI reads the file itself, so the message stays short.
                            event.preventDefault();

                            const field = event.currentTarget;
                            const start = field.selectionStart;
                            const caret = start + reference.length;

                            onChange(
                                value.slice(0, start) +
                                    reference +
                                    value.slice(field.selectionEnd),
                            );
                            requestAnimationFrame(() =>
                                field.setSelectionRange(caret, caret),
                            );
                        } else if (paths.length > 0) {
                            event.preventDefault();
                            onPastePaths(paths);
                        }
                    }}
                    onKeyDown={(event) => {
                        if (menuOpen) {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setActiveSuggestion(
                                    (activeSuggestion + 1) % suggestions.length,
                                );

                                return;
                            }

                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setActiveSuggestion(
                                    (activeSuggestion +
                                        suggestions.length -
                                        1) %
                                        suggestions.length,
                                );

                                return;
                            }

                            if (event.key === 'Enter' || event.key === 'Tab') {
                                event.preventDefault();
                                pick(suggestions[activeSuggestion]);

                                return;
                            }

                            if (event.key === 'Escape') {
                                setDismissed(true);

                                return;
                            }
                        }

                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                        }
                    }}
                    rows={2}
                    aria-label="Tin nhắn"
                    placeholder="Nhắn tin cho trợ lý AI"
                    className="block w-full resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                <div
                    data-focus-input
                    className="mt-2 flex flex-wrap items-center gap-1"
                >
                    {project === null ? (
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
                                                    {MODES.find(
                                                        (option) =>
                                                            option.value ===
                                                            mode,
                                                    )?.label ?? mode}
                                                </DropdownMenuSubTrigger>
                                                <DropdownMenuSubContent>
                                                    <DropdownMenuRadioGroup
                                                        value={mode}
                                                        onValueChange={
                                                            onModeChange
                                                        }
                                                    >
                                                        {MODES.map((option) => (
                                                            <DropdownMenuRadioItem
                                                                key={
                                                                    option.value
                                                                }
                                                                value={
                                                                    option.value
                                                                }
                                                                title={
                                                                    option.hint
                                                                }
                                                            >
                                                                {option.label}
                                                            </DropdownMenuRadioItem>
                                                        ))}
                                                    </DropdownMenuRadioGroup>
                                                </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            <DropdownMenuCheckboxItem
                                                checked={agentTeam}
                                                onCheckedChange={
                                                    onAgentTeamChange
                                                }
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
                                                    {MODES.find(
                                                        (option) =>
                                                            option.value ===
                                                            mode,
                                                    )?.label ?? mode}
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
                                                            title={option.hint}
                                                        >
                                                            {option.label}
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
                                            title="Bật agent team (tính năng thử nghiệm của Claude)"
                                            onClick={() =>
                                                onAgentTeamChange(!agentTeam)
                                            }
                                            className={`gap-1.5 ${agentTeam ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                                        >
                                            <Users aria-hidden="true" />
                                            Agent team
                                        </Button>
                                    </>
                                )}
                            </span>
                        </>
                    ) : (
                        <Inert label="Thêm" className="text-muted-foreground">
                            <Plus aria-hidden="true" />
                        </Inert>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    aria-label="Chọn AI và model"
                                    className="gap-2 text-muted-foreground"
                                >
                                    <CliIcon
                                        aria-hidden="true"
                                        className="size-5"
                                    />
                                    {MODELS[cli].find(
                                        (option) => option.value === model,
                                    )?.label ?? model}
                                    <ChevronDown aria-hidden="true" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {CLIS.map((option) => {
                                    const OptionIcon = CLI_ICONS[option.value];

                                    return (
                                        <DropdownMenuSub key={option.value}>
                                            <DropdownMenuSubTrigger
                                                className={
                                                    option.value === cli
                                                        ? 'font-medium'
                                                        : undefined
                                                }
                                            >
                                                <OptionIcon
                                                    aria-hidden="true"
                                                    className="size-4"
                                                />
                                                {option.label}
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent
                                                alignOffset={
                                                    -(
                                                        MODELS[option.value]
                                                            .length - 1
                                                    ) * MENU_ITEM_HEIGHT
                                                }
                                            >
                                                <DropdownMenuRadioGroup
                                                    value={
                                                        option.value === cli
                                                            ? (model ?? '')
                                                            : ''
                                                    }
                                                    onValueChange={(next) =>
                                                        onChoose(
                                                            option.value,
                                                            next || null,
                                                        )
                                                    }
                                                >
                                                    {MODELS[option.value].map(
                                                        (item) => (
                                                            <DropdownMenuRadioItem
                                                                key={
                                                                    item.value ??
                                                                    'default'
                                                                }
                                                                value={
                                                                    item.value ??
                                                                    ''
                                                                }
                                                            >
                                                                {item.label}
                                                            </DropdownMenuRadioItem>
                                                        ),
                                                    )}
                                                </DropdownMenuRadioGroup>
                                            </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Inert label="Đọc to" className="text-muted-foreground">
                            <Volume2 aria-hidden="true" />
                        </Inert>
                        <Inert label="Ghi âm" className="text-muted-foreground">
                            <Mic aria-hidden="true" />
                        </Inert>
                        <Button
                            type="submit"
                            size="icon-sm"
                            disabled={
                                busy ||
                                (value.trim() === '' &&
                                    attachments.length === 0)
                            }
                            aria-label="Gửi"
                            className="rounded-full"
                        >
                            <ArrowUp aria-hidden="true" />
                        </Button>
                    </span>
                </div>
            </div>
        </form>
    );
}
