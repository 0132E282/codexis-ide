import { invoke } from '@/lib/invoke';
import { listen } from '@tauri-apps/api/event';

export type LanguageServerId = 'rust-analyzer' | 'intelephense' | 'csharp-ls';
/** What the person chose; `auto` takes the first usable extension, then PATH. */
export type ServerSourceSetting = 'auto' | 'vscode' | 'path' | 'download';
/** Editor whose extension folder is read (read-only). */
export type ExtensionRoot = 'vscode' | 'insiders' | 'cursor' | 'vscodium';
export type CandidateOrigin = ExtensionRoot | 'path' | 'download';
export type ServerState =
    'missing' | 'stopped' | 'starting' | 'running' | 'error';

/** Monaco coordinates: 1-based lines and UTF-16 columns. */
export type EditorPosition = { lineNumber: number; column: number };
export type EditorRange = {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
};
export type TextEdit = { range: EditorRange; text: string };

/** One place a server was found. */
export type ServerCandidate = {
    origin: CandidateOrigin;
    /** Extension display name, or the binary name for PATH. */
    label: string;
    extensionId: string | null;
    version: string | null;
    /** Absolute path of the server file, shown in the tab only. */
    path: string;
    /** `language_server.*` key; null = usable. */
    problem: string | null;
};

export type InstallHint = {
    /** Extension to install in VS Code; null for csharp-ls. */
    extensionId: string | null;
    displayName: string;
    /** i18n key of the instruction. */
    messageKey: string;
};

export type ServerFeatures = {
    completion: boolean;
    completionResolve: boolean;
    completionTriggerCharacters: string[];
    hover: boolean;
    signatureHelp: boolean;
    signatureTriggerCharacters: string[];
    signatureRetriggerCharacters: string[];
    definition: boolean;
    rename: boolean;
    prepareRename: boolean;
    formatting: boolean;
};

export type LanguageServerInfo = {
    id: LanguageServerId;
    name: string;
    /** Monaco language ids: `rust`, `php`, `csharp`. */
    languages: string[];
    fileExtensions: string[];
    enabled: boolean;
    source: ServerSourceSetting;
    extensionRoot: ExtensionRoot | null;
    candidates: ServerCandidate[];
    /** Index in `candidates` of the one used now (or next start); null = none usable. */
    selected: number | null;
    /** State for the given root. */
    state: ServerState;
    lastError: string | null;
    installHint: InstallHint | null;
    /** Always false in phase 1. */
    canDownload: boolean;
};

export type DocumentOpened = {
    /** Canonical root: the key events carry. */
    root: string;
    serverId: LanguageServerId;
    state: ServerState;
    /** null until the server is running. */
    features: ServerFeatures | null;
};

/** One Monaco content change; `range = null` replaces the whole text. */
export type DocumentChange = { range: EditorRange | null; text: string };

export type RequestKind =
    | 'completion'
    | 'completion_resolve'
    | 'hover'
    | 'signature_help'
    | 'definition'
    | 'prepare_rename'
    | 'rename'
    | 'formatting';

export type CompletionItem = {
    label: string;
    /** LSP CompletionItemKind (1..25); the bridge maps it to Monaco's enum. */
    kind: number | null;
    detail: string | null;
    /** Markdown. */
    documentation: string | null;
    insertText: string;
    isSnippet: boolean;
    range: EditorRange | null;
    additionalTextEdits: TextEdit[];
    sortText: string | null;
    filterText: string | null;
    commitCharacters: string[];
    preselect: boolean;
    /** Opaque; valid until the next completion on the same document. */
    resolveKey: string | null;
};

export type CompletionResult = {
    isIncomplete: boolean;
    items: CompletionItem[];
};

export type HoverResult = {
    /** Markdown. */
    contents: string;
    range: EditorRange | null;
} | null;

export type SignatureHelpResult = {
    signatures: {
        label: string;
        documentation: string | null;
        parameters: {
            label: string | [number, number];
            documentation: string | null;
        }[];
    }[];
    activeSignature: number;
    activeParameter: number;
} | null;

export type DefinitionTarget = {
    /** Relative to the root; null outside the root. */
    path: string | null;
    /** Display path (`~` for HOME) when outside the root. */
    external: string | null;
    range: EditorRange;
};

export type PrepareRenameResult = {
    range: EditorRange;
    placeholder: string;
} | null;

export type FileEdits = {
    /** Relative to the root. */
    path: string;
    edits: TextEdit[];
    /** Hash of the file on disk when the plan was made; null = not readable. */
    expectedHash: string | null;
};

export type RenamePlan = {
    /** Files inside the root that may be written. */
    files: (FileEdits & { editCount: number })[];
    /** Outside the root or denied: never written. `reason` is an error key. */
    skipped: { display: string; reason: string }[];
};

export type ApplyEditResult = {
    written: string[];
    failed: { path: string; error: string }[];
};

export type Diagnostic = {
    range: EditorRange;
    /** LSP DiagnosticSeverity: 1 error, 2 warning, 3 information, 4 hint. */
    severity: 1 | 2 | 3 | 4;
    message: string;
    source: string | null;
    /** LSP code as text. */
    code: string | null;
};

export type DiagnosticsEvent = {
    root: string;
    serverId: LanguageServerId;
    path: string;
    version: number | null;
    diagnostics: Diagnostic[];
};

export type StatusEvent = {
    /** null when a setting changed for every project. */
    root: string | null;
    serverId: LanguageServerId;
    state: ServerState;
    enabled: boolean;
    lastError: string | null;
    features: ServerFeatures | null;
};

export const ideLanguageServer = {
    list: (root?: string | null) =>
        invoke<LanguageServerInfo[]>('language_server_list', { root }),
    configure: (
        id: LanguageServerId,
        enabled: boolean,
        source: ServerSourceSetting,
        extensionRoot: ExtensionRoot | null,
    ) =>
        invoke<LanguageServerInfo>('language_server_configure', {
            id,
            enabled,
            source,
            extensionRoot,
        }),
    restart: (root: string | null, id: LanguageServerId) =>
        invoke<void>('language_server_restart', { root, id }),
    stop: (root: string | null, id: LanguageServerId) =>
        invoke<void>('language_server_stop', { root, id }),
    log: (root: string | null, id: LanguageServerId) =>
        invoke<string[]>('language_server_log', { root, id }),
    documentOpen: (root: string | null, path: string, text: string) =>
        invoke<DocumentOpened | null>('language_server_document_open', {
            root,
            path,
            text,
        }),
    documentChange: (
        root: string | null,
        path: string,
        changes: DocumentChange[],
    ) =>
        invoke<void>('language_server_document_change', {
            root,
            path,
            changes,
        }),
    documentSave: (root: string | null, path: string, text: string) =>
        invoke<void>('language_server_document_save', { root, path, text }),
    documentClose: (root: string | null, path: string) =>
        invoke<void>('language_server_document_close', { root, path }),
    request: <T>(
        root: string | null,
        path: string,
        kind: RequestKind,
        position: EditorPosition | null,
        options: object | null,
    ) =>
        invoke<T>('language_server_request', {
            root,
            path,
            kind,
            position,
            options,
        }),
    applyEdit: (root: string | null, files: FileEdits[]) =>
        invoke<ApplyEditResult>('language_server_apply_edit', { root, files }),
    onDiagnostics: (handler: (event: DiagnosticsEvent) => void) =>
        listen<DiagnosticsEvent>('language-server-diagnostics', ({ payload }) =>
            handler(payload),
        ),
    onStatus: (handler: (event: StatusEvent) => void) =>
        listen<StatusEvent>('language-server-status', ({ payload }) =>
            handler(payload),
        ),
};
