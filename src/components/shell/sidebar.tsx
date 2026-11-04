import {
    ChartColumn,
    EllipsisVertical,
    Folder,
    FolderOpen,
    Plus,
    Settings,
    Trash2,
} from 'lucide-react';
import { Fragment, useState } from 'react';
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
import { NewProjectDialog } from '@/components/shell/new-project-dialog';
import type { ChatConversation, Project } from '@/lib/ide';
import { cn } from '@/lib/utils';

const IS_MAC = navigator.userAgent.includes('Macintosh');

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
    onOpenConversation,
    onDeleteConversation,
    onNewChat,
    onOpenSettings,
    onOpenUsage,
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
    onRemove: (id: string) => void;
    /** Conversations of the open project, the most recently used first. */
    conversations: ChatConversation[];
    /** The conversation shown in the chat; null until it is loaded. */
    currentConversation: number | null;
    onOpenConversation: (id: number) => void;
    onDeleteConversation: (id: number) => void;
    /** Starts a new conversation with the AI in the open project. */
    onNewChat: () => void;
    /** Opens the chat settings on `tab`. */
    onOpenSettings: (tab: SettingsTab) => void;
    onOpenUsage: () => void;
}) {
    const [query, setQuery] = useState('');
    const needle = plain(query.trim());
    const rows: { id: string | null; name: string }[] =
        projects.length > 0
            ? projects
            : startupName !== null
              ? [{ id: null, name: startupName }]
              : [];
    const visible = rows.filter((row) => plain(row.name).includes(needle));

    return (
        <aside
            aria-label="Thanh bên"
            className="flex w-64 shrink-0 flex-col border-r bg-background max-[900px]:w-48"
        >
            {/* * The title bar overlays the window (macOS): the logo sits in the row of the window buttons, to their right. */}
            <div
                className={`flex h-12 shrink-0 items-center gap-2 select-none ${IS_MAC ? 'pl-[4.5rem]' : 'pl-4'}`}
            >
                <img src={logo} alt="" className="size-7" />
                <span className="text-lg font-semibold">Codexis</span>
            </div>
            <div className="flex items-center justify-between px-3 pb-2 text-sm">
                <span className="text-muted-foreground">Dự án</span>
                <NewProjectDialog onCreated={onCreated}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                    >
                        <Plus aria-hidden="true" />
                        Thêm mới dự án
                    </Button>
                </NewProjectDialog>
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
                    aria-label="Tìm dự án"
                    placeholder="Tìm dự án..."
                />
            </div>
            <nav
                aria-label="Dự án"
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
                {needle !== '' && visible.length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                        Không tìm thấy dự án.
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
                                        'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/60',
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
                                        title="Số cuộc trò chuyện"
                                        className="shrink-0 text-xs text-muted-foreground tabular-nums group-hover:invisible"
                                    >
                                        {active ? conversations.length : ''}
                                    </span>
                                </button>
                                {row.id !== null && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={`Xóa dự án ${row.name} khỏi danh sách`}
                                        title="Xóa khỏi danh sách (không xóa thư mục)"
                                        onClick={() =>
                                            onRemove(row.id as string)
                                        }
                                        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                    >
                                        <Trash2 aria-hidden="true" />
                                    </Button>
                                )}
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
                                    Cuộc trò chuyện mới
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
                                                        'Cuộc trò chuyện'}
                                                </span>
                                            </button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-label="Xóa cuộc trò chuyện"
                                                title="Xóa cuộc trò chuyện"
                                                onClick={() =>
                                                    onDeleteConversation(
                                                        conversation.id,
                                                    )
                                                }
                                                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/chat:opacity-100 focus-visible:opacity-100"
                                            >
                                                <Trash2 aria-hidden="true" />
                                            </Button>
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
                        Chưa kết nối trợ lý AI
                    </p>
                </div>
                <span
                    role="img"
                    aria-label="Trợ lý AI chưa kết nối"
                    className="size-2 shrink-0 rounded-full bg-muted-foreground/60"
                />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Thêm"
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
                            Cài đặt chat
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={onOpenUsage}>
                            <ChartColumn aria-hidden="true" />
                            Thống kê
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </aside>
    );
}
