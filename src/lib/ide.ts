import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

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
/** A sub-agent the AI started in the current turn. */
export type Subagent = { id: string; label: string; done: boolean };
/** One saved chat turn. */
export type ChatTurnRecord = {
    id: string;
    cli: AgentCli;
    prompt: string;
    answer: string;
    error: string | null;
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
        }),
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
    chatList: (root?: string) =>
        invoke<ChatConversation[]>('chat_list', { root }),
    /** Starts a new conversation (the previous ones stay in the list) and resolves to its id. */
    chatNew: (workspace: string) => invoke<number>('chat_new', { workspace }),
    chatDelete: (conversation: number, root?: string) =>
        invoke<void>('chat_delete', { conversation, root }),
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
        | 'subagent'
        | 'subagentdone'
        | 'error'
        | 'done';
    text: string;
};

/** Listens to the events of chat turns; resolves to the function that stops listening. */
export const onAgentEvent = (handler: (event: AgentEvent) => void) =>
    listen<AgentEvent>('agent-event', ({ payload }) => handler(payload));

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
    return typeof error === 'string' ? error : 'Có lỗi xảy ra.';
}
