/** An edit the AI proposes for a file of the project, and what became of it. */
export type AiChatProposal = {
    id: number | string;
    /** The answer (message) the edit belongs to; the apply / reject / revert calls are addressed with it. */
    messageId?: number | string;
    /** The project the file belongs to. */
    repo: string;
    path: string;
    /** `update` changes an existing file, `create` makes a new one. */
    action: 'update' | 'create';
    status: 'pending' | 'applied' | 'rejected' | 'reverted';
    /** Unified diff of the edit. */
    diff?: string | null;
    /** The whole file as it would be after the edit. */
    content?: string | null;
};

/** One thing the app did while the AI answered (read a file, looked at the tree...). */
export type AiChatActivityStep = {
    /** What was done: `tree`, `file`, `attachment`, `image` or `ask`. */
    kind: string;
    /** Where it was read from. */
    source: string;
    /** The file, path or sentence the step is about. */
    detail: string;
};
