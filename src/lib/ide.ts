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
          /** Pictures the call returned (a screenshot), as data URLs. */
          images?: string[];
          status: 'running' | 'ok' | 'error';
      };
/** A file with uncommitted changes in a git workspace. */
export type ChangedFile = {
    path: string;
    status: string;
    added: number | null;
    removed: number | null;
};
/** Kind of a branch or tag label on a commit; `head` is `HEAD` itself. */
export type GitRefKind = 'local' | 'remote' | 'tag' | 'head';
export type GitRefLabel = { name: string; kind: GitRefKind };
/** One commit of a log; `timestamp` is unix seconds. */
export type GitCommit = {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    authorEmail: string;
    timestamp: number;
    parents: string[];
    refs: GitRefLabel[];
};
/** A file a commit changed; `status` is A, M, D, R, C or T, counts are null for a binary file. */
export type GitCommitFile = {
    path: string;
    status: string;
    oldPath?: string;
    additions: number | null;
    deletions: number | null;
};
/** Unified diff of one file in a commit, cut when `truncated`. */
export type GitFileDiff = { diff: string; truncated: boolean };
/** Blame of one line; `committed` is false (hash all zeros, empty author and subject) while the line is not committed. */
export type GitBlameLine = {
    line: number;
    hash: string;
    shortHash: string;
    authorName: string;
    timestamp: number;
    subject: string;
    committed: boolean;
};
export type GitBranchesInfo = {
    git: boolean;
    current: string | null;
    local: string[];
    remotes: string[];
};
/** Commits `head` has that `base` lacks (`ahead`) and the other way round (`behind`). */
export type GitBranchCompare = { ahead: number; behind: number };
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
    /** Context usage after the turn, as JSON of `ContextUsage`. */
    context?: string | null;
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

/** How far a plan document stands, one vocabulary for the JSON and Markdown plans. */
export type PlanDocStatus =
    | 'done'
    | 'in_progress'
    | 'partial'
    | 'todo'
    | 'draft'
    | 'review'
    | 'unknown';
/** One plan of the project's `docs/plans/` folder (a card). */
export type PlanDoc = {
    /** Path relative to the project (the key of the card). */
    id: string;
    title: string;
    description: string;
    tags: string[];
    status: PlanDocStatus;
    /** The status word as written in the file. */
    rawStatus: string | null;
    createdAt: string | null;
    format: 'json' | 'md';
    /** A `.md` twin sits beside this JSON plan. */
    hasMarkdown: boolean;
    tasksTotal: number;
    tasksDone: number;
    /** Path relative to the project, to open in the editor. */
    path: string;
    /** Last change, seconds since the Unix epoch. */
    modifiedAt: number;
};
/** A requirement, acceptance criterion or open question of a plan. */
export type PlanItem = {
    id: string | null;
    text: string;
    /** Where it comes from, which requirement it checks, or its default answer. */
    note: string | null;
};
export type PlanTask = {
    id: string | null;
    title: string;
    status: PlanDocStatus;
    rawStatus: string | null;
    priority: string | null;
    /** Files the task says it changes. */
    files: string[];
};
/** One block of a Markdown plan. */
export type MarkdownBlock =
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'bullet'; text: string }
    | { kind: 'checklist'; text: string; checked: boolean }
    | { kind: 'code'; text: string };
/** A plan in full: its card plus the sections of the file. */
export type PlanDocDetail = PlanDoc & {
    requirements: PlanItem[];
    tasks: PlanTask[];
    acceptanceCriteria: PlanItem[];
    openQuestions: PlanItem[];
    /** The body of a Markdown plan (empty for a JSON plan). */
    blocks: MarkdownBlock[];
};
export type PlanDocsList = {
    /** The project folder that was read. */
    root: string;
    plans: PlanDoc[];
    /** Files that could not be read or understood. */
    skipped: number;
    truncated: boolean;
};

export const ide = {
    windowButtonsVisible: (visible: boolean) =>
        invoke<void>('window_buttons_visible', { visible }),
    windowIsFullscreen: () => invoke<boolean>('window_is_fullscreen'),
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
    /** Creates an empty file or folder named `name` inside `folder` (empty: the project root); resolves to the new path. */
    workspaceCreate: (
        folder: string,
        name: string,
        isFolder: boolean,
        root?: string,
    ) => invoke<string>('workspace_create', { root, folder, name, isFolder }),
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
        /** Resumes the session into a new one (Claude's `--fork-session`): for a turn that starts while another still runs on the same session. */
        fork = false,
    ) =>
        invoke<void>('agent_send', {
            fork,
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
    /** Commits of a branch, newest first (the current branch when `branch` is null); `limit` is 1 to 200. Rejects with `git.not_repository` outside a repository. */
    gitLog: (
        branch: string | null,
        limit: number,
        skip: number,
        root?: string,
    ) => invoke<GitCommit[]>('git_log', { root, branch, limit, skip }),
    /** Files one commit changed. */
    gitCommitFiles: (hash: string, root?: string) =>
        invoke<GitCommitFile[]>('git_commit_files', { root, hash }),
    /** Diff of one file in one commit (at most 512 KiB). */
    gitCommitFileDiff: (hash: string, path: string, root?: string) =>
        invoke<GitFileDiff>('git_commit_file_diff', { root, hash, path }),
    /** Commits that touched a file, renames followed. */
    gitFileHistory: (
        path: string,
        limit: number,
        skip: number,
        root?: string,
    ) => invoke<GitCommit[]>('git_file_history', { root, path, limit, skip }),
    /** Per-line blame of a file as it is on disk. */
    gitBlame: (path: string, root?: string) =>
        invoke<GitBlameLine[]>('git_blame', { root, path }),
    /** Current, local and remote branches (`git` false outside a repository). */
    gitBranchesInfo: (root?: string) =>
        invoke<GitBranchesInfo>('git_branches_info', { root }),
    /** How far `head` is ahead of and behind `base`. */
    gitBranchCompare: (base: string, head: string, root?: string) =>
        invoke<GitBranchCompare>('git_branch_compare', { root, base, head }),
    /** Switches to a local branch; resolves to the branch now checked out. */
    gitCheckout: (branch: string, root?: string) =>
        invoke<string>('git_checkout', { root, branch }),
    /** Merges a branch into the current one (a conflict is cancelled); resolves to the current branch. */
    gitMerge: (branch: string, root?: string) =>
        invoke<string>('git_merge', { root, branch }),
    /** Fast-forward pull of the current branch; resolves to the current branch. */
    gitPull: (root?: string) => invoke<string>('git_pull', { root }),
    /** Commits of the current branch that no remote has yet, newest first. */
    gitOutgoing: (root?: string) =>
        invoke<GitCommit[]>('git_outgoing', { root }),
    /** Pushes the current branch (publishing it to `origin` when it has no upstream); resolves to the branch name. */
    gitPush: (root?: string) => invoke<string>('git_push', { root }),
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
    saveAttachment: async (
        file: File,
        /** A picture is also kept in the database for this project (the open one when absent) and conversation. */
        keep?: { root?: string; conversation?: number },
    ) =>
        invoke<string>(
            'attachment_save',
            new Uint8Array(await file.arrayBuffer()),
            {
                headers: {
                    'x-name': encodeURIComponent(file.name),
                    ...(keep?.root === undefined
                        ? {}
                        : { 'x-root': encodeURIComponent(keep.root) }),
                    ...(keep?.conversation === undefined
                        ? {}
                        : { 'x-conversation': String(keep.conversation) }),
                },
            },
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
    /** The plans written in `docs/plans/` of the project (newest first, JSON preferred over Markdown); empty when the folder is absent. */
    planDocsList: (root?: string) =>
        invoke<PlanDocsList>('plan_docs_list', { root }),
    /** One plan of `docs/plans/` in full; `path` is the `path` of its card. */
    planDocRead: (path: string, root?: string) =>
        invoke<PlanDocDetail>('plan_doc_read', { path, root }),
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
        | 'idle'
        | 'result'
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

/** Listens to changes of the plan files of a project (`docs/plans/`); the handler gets the project folder. Resolves to the function that stops listening. */
export const onPlansChanged = (handler: (root: string) => void) =>
    listen<{ root: string }>('plans-changed', ({ payload }) =>
        handler(payload.root),
    );

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
