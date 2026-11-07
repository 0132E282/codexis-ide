import { invoke } from '@/lib/invoke';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/lib/i18n';

export type FileContent = { content: string; hash: string };
export type EnvVar = { key: string; value: string };
export type Project = {
    id: string;
    name: string;
    folders: string[];
    env: EnvVar[];
};
export type NewProject = Omit<Project, 'id'>;
/** A workspace: its folder name and the full path that addresses it in the other commands. */
export type ProjectInfo = { name: string; root: string };
export type AgentCli = 'claude' | 'codex';
/** One step of a turn that is shown live: the AI's words, or a tool call with its result. */
export type Step =
    | { kind: 'text'; text: string }
    /** In a turn relayed between AIs: the AI whose steps follow. */
    | { kind: 'speaker'; cli: AgentCli }
    | {
          kind: 'tool';
          id: string;
          name: string;
          /** The AI's own short description of the call. */
          description: string;
          /** What the call works on: the command, path or pattern. */
          input: string;
          /** For a file edit: the text it replaces and the text it puts there. */
          change?: { before: string; after: string };
          /** Null until the call returns. */
          output: string | null;
          status: 'running' | 'ok' | 'error';
      };
/** A file with uncommitted changes in a git workspace. */
export type ChangedFile = {
    path: string;
    status: string;
    added: number | null;
    removed: number | null;
};
/** A sub-agent the AI started in the current turn. */
export type Subagent = { id: string; label: string; done: boolean };
/** One chat of the grid: a conversation and the project folder (`workspace`) it belongs to. */
export type GridMember = {
    /** The group (grid) the chat is in; a group holds at most four chats. */
    group: number;
    workspace: string;
    conversation: number;
    /** Title of the conversation, for the sidebar. */
    title: string;
};
/** One saved chat turn. */
export type ChatTurnRecord = {
    id: string;
    cli: AgentCli;
    prompt: string;
    answer: string;
    error: string | null;
    /** What the AI did during the turn, as JSON of `Step[]`. */
    steps?: string | null;
};
/** Saved chat of the open workspace; `workspace` is the key to hand back when saving. */
export type ChatHistory = {
    workspace: string;
    /** Id of the conversation these turns belong to. */
    conversation: number;
    turns: ChatTurnRecord[];
    /** Session id of each CLI: passing it back continues that CLI's conversation. */
    sessions: Partial<Record<AgentCli, string>>;
};

/** One entry of the conversation list of the open workspace. */
export type ChatConversation = {
    id: number;
    /** First message of the conversation, cut short. */
    title: string;
    /** Unix seconds of the last saved turn. */
    updatedAt: number;
    turns: number;
};

export const ide = {
    windowButtonsVisible: (visible: boolean) =>
        invoke<void>('window_buttons_visible', { visible }),
    info: () => invoke<ProjectInfo>('workspace_info'),
    tree: (root?: string) =>
        invoke<{ paths: string[]; truncated: boolean }>('workspace_tree', {
            root,
        }),
    read: (path: string, root?: string) =>
        invoke<FileContent>('workspace_read', { path, root }),
    write: (
        path: string,
        content: string,
        expectedHash: string | null,
        root?: string,
    ) =>
        invoke<string>('workspace_write', {
            path,
            content,
            expectedHash,
            root,
        }),
    projects: () =>
        invoke<{ projects: Project[]; selected: string | null }>(
            'projects_list',
        ),
    addProject: (project: NewProject) =>
        invoke<Project>('projects_add', { project }),
    removeProject: (id: string) => invoke<void>('projects_remove', { id }),
    /** Switches the open workspace to the project's first folder. */
    selectProject: (id: string) =>
        invoke<ProjectInfo>('projects_select', { id }),
    openInVscode: (path?: string, line?: number, root?: string) =>
        invoke<void>('open_in_vscode', { path, line, root }),
    /** Starts the server the phone app connects to (or returns the running one); its address and token go into the QR code. */
    remoteStart: () => invoke<RemoteInfo>('remote_start'),
    /** Stops that server: every phone is dropped and the token stops working. */
    remoteStop: () => invoke<void>('remote_stop'),
    /** Opens a shell in the project folder; its output arrives through `onTerminalData`. */
    terminalOpen: (id: string, columns: number, rows: number, root?: string) =>
        invoke<void>('terminal_open', { id, columns, rows, root }),
    terminalWrite: (id: string, data: string) =>
        invoke<void>('terminal_write', { id, data }),
    terminalResize: (id: string, columns: number, rows: number) =>
        invoke<void>('terminal_resize', { id, columns, rows }),
    terminalClose: (id: string) => invoke<void>('terminal_close', { id }),
    /** Starts one chat turn; the answer arrives through `onAgentEvent`, tagged with `runId`. */
    agentSend: (
        runId: string,
        cli: AgentCli,
        prompt: string,
        session: string | null,
        /** Model for `--model` / `-m`; null keeps the CLI's own default. */
        model: string | null,
        /** Permission mode (`--permission-mode`, Claude only); null keeps the CLI's own. */
        mode: string | null,
        /** Switches on the Claude CLI's experimental agent teams for this turn. */
        agentTeam: boolean,
        /** Folder of the project the turn runs in (its `root`). */
        root?: string,
        /** Folders of more saved projects the AI may also work in during this turn. */
        extraRoots?: string[],
        /** Runs the turn in a git worktree of this name (own branch, project untouched). */
        worktree?: string,
    ) =>
        invoke<void>('agent_send', {
            runId,
            cli,
            prompt,
            session,
            model,
            mode,
            agentTeam,
            root,
            extraRoots,
            worktree,
        }),
    /** Files with uncommitted changes in the workspace (empty when it is not a git repository). */
    localChanges: async (root?: string) =>
        (
            await invoke<{ git: boolean; files: ChangedFile[] }>(
                'local_changes',
                { root },
            )
        ).files,
    /** Stops a running turn: the CLI is ended and the turn finishes with what it had. */
    agentStop: (runId: string) => invoke<void>('agent_stop', { runId }),
    /** Answers a permission question of a running turn ("Hỏi từng việc"): `allow` lets the tool run with `input`, otherwise it is denied. */
    agentPermission: (
        runId: string,
        requestId: string,
        allow: boolean,
        input: unknown,
    ) => invoke<void>('agent_permission', { runId, requestId, allow, input }),
    /** Saves a pasted image or file in the app cache; resolves to the path to put in the message as `@path`. */
    saveAttachment: async (file: File) =>
        invoke<string>(
            'attachment_save',
            new Uint8Array(await file.arrayBuffer()),
            { headers: { 'x-name': encodeURIComponent(file.name) } },
        ),
    /** Bytes of a saved attachment (only files of the attachments folder), to show it in the chat. */
    readAttachment: (path: string) =>
        invoke<ArrayBuffer>('attachment_read', { path }),
    /** Turns of a conversation (the most recent one when none is named). */
    chatLoad: (conversation?: number, root?: string) =>
        invoke<ChatHistory>('chat_load', {
            conversation: conversation ?? null,
            root,
        }),
    /** The plan the AI wrote in a CLI session of the project: JSON of `{todos, markdown}`, or null when there is none. */
    planLoad: (session: string, root?: string) =>
        invoke<string | null>('plan_load', { session, root }),
    chatList: (root?: string) =>
        invoke<ChatConversation[]>('chat_list', { root }),
    /** Starts a new conversation (the previous ones stay in the list) and resolves to its id. */
    chatNew: (workspace: string) => invoke<number>('chat_new', { workspace }),
    chatDelete: (conversation: number, root?: string) =>
        invoke<void>('chat_delete', { conversation, root }),
    /** Chats picked for the chat grids, across projects, by group and in grid order (a grid shows from two chats on). */
    chatGridGet: () => invoke<GridMember[]>('chat_grid_get'),
    /** Saves the chat grids: each group has at most four chats, each with its project folder; an empty list clears them. */
    chatGridSave: (
        picks: { group: number; root: string; conversation: number }[],
    ) => invoke<void>('chat_grid_save', { picks }),
    chatSaveTurn: (
        workspace: string,
        conversation: number,
        turn: ChatTurnRecord,
    ) => invoke<void>('chat_save_turn', { workspace, conversation, turn }),
    chatSaveSession: (
        workspace: string,
        conversation: number,
        cli: AgentCli,
        session: string,
    ) =>
        invoke<void>('chat_save_session', {
            workspace,
            conversation,
            cli,
            session,
        }),
};

export type AgentEvent = {
    runId: string;
    kind:
        | 'session'
        | 'text'
        | 'delta'
        | 'tool'
        | 'toolresult'
        | 'subtext'
        | 'subagent'
        | 'subagentdone'
        | 'permission'
        | 'context'
        | 'plan'
        | 'background'
        | 'speaker'
        | 'error'
        | 'done';
    text: string;
};

/** What the phone app needs to connect (the QR code holds it). */
export type RemoteInfo = { host: string; port: number; token: string };

/** Listens to messages the phone app sends to the chat; resolves to the function that stops listening. */
export const onRemoteSend = (handler: (prompt: string) => void) =>
    listen<{ prompt: string }>('remote-send', ({ payload }) =>
        handler(payload.prompt),
    );

/** Listens to phones connecting or leaving (the number now connected). */
export const onRemoteConnected = (handler: (count: number) => void) =>
    Promise.all([
        listen<number>('remote-connected', ({ payload }) => handler(payload)),
        listen<number>('remote-disconnected', ({ payload }) =>
            handler(payload),
        ),
    ]).then((stops) => () => stops.forEach((stop) => stop()));

/** Listens to the events of chat turns; resolves to the function that stops listening. */
export const onAgentEvent = (handler: (event: AgentEvent) => void) =>
    listen<AgentEvent>('agent-event', ({ payload }) => handler(payload));

/** Listens to what the shells of the terminal panel print. */
export const onTerminalData = (
    handler: (event: { id: string; data: string }) => void,
) =>
    listen<{ id: string; data: string }>('terminal-data', ({ payload }) =>
        handler(payload),
    );

/** Listens to shells that ended (the id of each). */
export const onTerminalExit = (handler: (id: string) => void) =>
    listen<string>('terminal-exit', ({ payload }) => handler(payload));

/** Native folder picker; resolves to the chosen folders (empty when cancelled). */
export async function pickFolders(): Promise<string[]> {
    const chosen = await open({ directory: true, multiple: true });

    return chosen ?? [];
}

/** Native file picker; resolves to the chosen files (empty when cancelled). */
export async function pickFiles(): Promise<string[]> {
    const chosen = await open({ directory: false, multiple: true });

    return chosen ?? [];
}

/** Tauri rejects with the Rust error string. */
export function errorText(error: unknown): string {
    return typeof error === 'string' ? error : t('common.something_went_wrong');
}
