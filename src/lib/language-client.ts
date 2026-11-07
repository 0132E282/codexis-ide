import * as monaco from 'monaco-editor';
import type { CancellationToken, editor, languages } from 'monaco-editor';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { ideLanguageServer } from '@/lib/ide-language-server';
import type {
    CompletionItem,
    CompletionResult,
    DefinitionTarget,
    Diagnostic,
    DiagnosticsEvent,
    EditorPosition,
    EditorRange,
    FileEdits,
    HoverResult,
    LanguageServerId,
    PrepareRenameResult,
    RenamePlan,
    RequestKind,
    ServerFeatures,
    SignatureHelpResult,
    StatusEvent,
    TextEdit,
} from '@/lib/ide-language-server';
import { onDocumentSaved } from '@/lib/language-save';

/** One model that a language server knows (the bridge keeps no other state about it). */
export type DocumentEntry = {
    model: editor.ITextModel;
    /** Root as the editor passes it to the commands. */
    requestRoot: string;
    /** Canonical root: the key events carry. */
    root: string;
    path: string;
    serverId: LanguageServerId;
    /** null while the server is not running: every provider then steps aside. */
    features: ServerFeatures | null;
    /** Sends the changes still waiting (the debounce) so a request sees the text the person sees. */
    flush: () => Promise<unknown>;
    /** Asks the person to confirm a rename plan. */
    confirmRename: (plan: RenamePlan) => Promise<boolean>;
    /** Opens a definition in another file of the project. */
    openTarget: (path: string, line: number, column: number) => void;
};

const LANGUAGE_IDS = ['rust', 'php', 'csharp'] as const;

const COMPLETION_TRIGGERS: Record<string, string[]> = {
    rust: ['.', ':'],
    php: ['>', ':', '$', '\\'],
    csharp: ['.'],
};

const COMPLETION_KINDS = [
    'Text',
    'Method',
    'Function',
    'Constructor',
    'Field',
    'Variable',
    'Class',
    'Interface',
    'Module',
    'Property',
    'Unit',
    'Value',
    'Enum',
    'Keyword',
    'Snippet',
    'Color',
    'File',
    'Reference',
    'Folder',
    'EnumMember',
    'Constant',
    'Struct',
    'Event',
    'Operator',
    'TypeParameter',
] as const;

const TARGET_SCHEME = 'lsp-target';
const EXTERNAL_SCHEME = 'lsp-external';

const entries = new Map<string, DocumentEntry>();
const statusListeners = new Set<(event: StatusEvent) => void>();
const featureListeners = new Set<() => void>();
const resolveKeys = new WeakMap<languages.CompletionItem, string>();
let started = false;

const keyOf = (model: editor.ITextModel) => model.uri.toString();

export function getEntry(model: editor.ITextModel | null) {
    return model === null ? undefined : entries.get(keyOf(model));
}

export function attachDocument(entry: DocumentEntry) {
    entries.set(keyOf(entry.model), entry);
}

/** Forgets the model and clears the markers the server drew on it. */
export function detachDocument(model: editor.ITextModel) {
    const entry = entries.get(keyOf(model));

    entries.delete(keyOf(model));

    if (entry !== undefined && !model.isDisposed()) {
        monaco.editor.setModelMarkers(model, `lsp:${entry.serverId}`, []);
    }
}

export function setEntryFeatures(
    entry: DocumentEntry,
    features: ServerFeatures | null,
) {
    entry.features = features;
    featureListeners.forEach((listener) => listener());
}

/** Called when any entry's features change (a server started or stopped). */
export function onFeaturesChanged(listener: () => void) {
    featureListeners.add(listener);

    return () => {
        featureListeners.delete(listener);
    };
}

/** Every status event, so a hook can reopen its document when a server is switched on. */
export function onServerStatus(listener: (event: StatusEvent) => void) {
    statusListeners.add(listener);

    return () => {
        statusListeners.delete(listener);
    };
}

const toRange = (range: EditorRange) =>
    new monaco.Range(
        range.startLineNumber,
        range.startColumn,
        range.endLineNumber,
        range.endColumn,
    );

const toEdits = (edits: TextEdit[]): languages.TextEdit[] =>
    edits.map((edit) => ({ range: toRange(edit.range), text: edit.text }));

/** An entry whose server is running and offers `feature`; otherwise the provider answers nothing without calling Rust. */
function entryFor(model: editor.ITextModel, feature: keyof ServerFeatures) {
    const entry = getEntry(model);

    return entry !== undefined && entry.features?.[feature] === true
        ? entry
        : undefined;
}

/** One request. Failures (including `cancelled`, `timeout`, a stopped server) are silent: the person just gets no suggestion. */
async function ask<T>(
    entry: DocumentEntry,
    kind: RequestKind,
    position: EditorPosition | null,
    options: object | null,
    token?: CancellationToken,
): Promise<T | undefined> {
    try {
        await entry.flush();

        if (token?.isCancellationRequested) {
            return undefined;
        }

        const result = await ideLanguageServer.request<T>(
            entry.requestRoot,
            entry.path,
            kind,
            position,
            options,
        );

        return token?.isCancellationRequested ? undefined : result;
    } catch {
        return undefined;
    }
}

const SEVERITY: Record<Diagnostic['severity'], monaco.MarkerSeverity> = {
    1: monaco.MarkerSeverity.Error,
    2: monaco.MarkerSeverity.Warning,
    3: monaco.MarkerSeverity.Info,
    4: monaco.MarkerSeverity.Hint,
};

function showDiagnostics(event: DiagnosticsEvent) {
    for (const entry of entries.values()) {
        if (
            entry.root !== event.root ||
            entry.path !== event.path ||
            entry.model.isDisposed()
        ) {
            continue;
        }

        monaco.editor.setModelMarkers(
            entry.model,
            `lsp:${event.serverId}`,
            event.diagnostics.map((diagnostic) => ({
                startLineNumber: diagnostic.range.startLineNumber,
                startColumn: diagnostic.range.startColumn,
                endLineNumber: diagnostic.range.endLineNumber,
                endColumn: diagnostic.range.endColumn,
                severity: SEVERITY[diagnostic.severity],
                message: diagnostic.message,
                source: diagnostic.source ?? undefined,
                code: diagnostic.code ?? undefined,
            })),
        );
    }
}

function applyStatus(event: StatusEvent) {
    for (const entry of entries.values()) {
        if (
            entry.serverId === event.serverId &&
            (event.root === null || event.root === entry.root)
        ) {
            entry.features = event.state === 'running' ? event.features : null;
        }
    }

    featureListeners.forEach((listener) => listener());
    statusListeners.forEach((listener) => listener(event));
}

/** Writes a confirmed rename: open models take it as an editor edit (undo works, saving is the person's), closed files go through the backend. */
async function applyRename(entry: DocumentEntry, plan: RenamePlan) {
    const closed: FileEdits[] = [];

    for (const file of plan.files) {
        const open = [...entries.values()].find(
            (candidate) =>
                candidate.requestRoot === entry.requestRoot &&
                candidate.path === file.path &&
                !candidate.model.isDisposed(),
        );

        if (open === undefined) {
            closed.push({
                path: file.path,
                edits: file.edits,
                expectedHash: file.expectedHash,
            });

            continue;
        }

        open.model.pushEditOperations(
            [],
            file.edits.map((edit) => ({
                range: toRange(edit.range),
                text: edit.text,
            })),
            () => null,
        );
    }

    if (closed.length === 0) {
        return;
    }

    try {
        const result = await ideLanguageServer.applyEdit(
            entry.requestRoot,
            closed,
        );

        for (const failure of result.failed) {
            toast.error(`${failure.path}: ${failure.error}`);
        }
    } catch (caught) {
        toast.error(String(caught));
    }
}

function completionItem(
    entry: DocumentEntry,
    item: CompletionItem,
    fallback: monaco.IRange,
): languages.CompletionItem {
    const kind =
        item.kind === null ? undefined : COMPLETION_KINDS[item.kind - 1];
    const result: languages.CompletionItem = {
        label: item.label,
        kind:
            kind === undefined
                ? monaco.languages.CompletionItemKind.Text
                : monaco.languages.CompletionItemKind[kind],
        detail: item.detail ?? undefined,
        documentation:
            item.documentation === null
                ? undefined
                : { value: item.documentation },
        insertText: item.insertText,
        insertTextRules: item.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
        range: item.range === null ? fallback : toRange(item.range),
        additionalTextEdits:
            item.additionalTextEdits.length === 0
                ? undefined
                : toEdits(item.additionalTextEdits),
        sortText: item.sortText ?? undefined,
        filterText: item.filterText ?? undefined,
        commitCharacters:
            item.commitCharacters.length === 0
                ? undefined
                : item.commitCharacters,
        preselect: item.preselect,
    };

    if (item.resolveKey !== null) {
        resolveKeys.set(result, item.resolveKey);
    }

    return result;
}

function registerFor(languageId: string) {
    monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: COMPLETION_TRIGGERS[languageId],
        provideCompletionItems: async (model, position, context, token) => {
            const entry = entryFor(model, 'completion');

            if (entry === undefined) {
                return undefined;
            }

            const word = model.getWordUntilPosition(position);
            const result = await ask<CompletionResult>(
                entry,
                'completion',
                { lineNumber: position.lineNumber, column: position.column },
                {
                    // * Monaco 0 invoke, 1 character, 2 incomplete list -> LSP 1, 2, 3.
                    triggerKind: context.triggerKind + 1,
                    ...(context.triggerCharacter === undefined
                        ? {}
                        : { triggerCharacter: context.triggerCharacter }),
                },
                token,
            );

            if (result === undefined) {
                return undefined;
            }

            const fallback = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            return {
                incomplete: result.isIncomplete,
                suggestions: result.items.map((item) =>
                    completionItem(entry, item, fallback),
                ),
            };
        },
        resolveCompletionItem: async (item, token) => {
            const key = resolveKeys.get(item);
            const entry = [...entries.values()].find(
                (candidate) =>
                    candidate.features?.completionResolve === true &&
                    !candidate.model.isDisposed() &&
                    candidate.model.getLanguageId() === languageId,
            );

            if (key === undefined || entry === undefined) {
                return item;
            }

            const resolved = await ask<CompletionItem>(
                entry,
                'completion_resolve',
                null,
                { resolveKey: key },
                token,
            );

            if (resolved === undefined) {
                return item;
            }

            return {
                ...item,
                detail: resolved.detail ?? item.detail,
                documentation:
                    resolved.documentation === null
                        ? item.documentation
                        : { value: resolved.documentation },
                additionalTextEdits:
                    resolved.additionalTextEdits.length === 0
                        ? item.additionalTextEdits
                        : toEdits(resolved.additionalTextEdits),
            };
        },
    });

    monaco.languages.registerHoverProvider(languageId, {
        provideHover: async (model, position, token) => {
            const entry = entryFor(model, 'hover');
            const result =
                entry === undefined
                    ? undefined
                    : await ask<HoverResult>(
                          entry,
                          'hover',
                          {
                              lineNumber: position.lineNumber,
                              column: position.column,
                          },
                          null,
                          token,
                      );

            return result === undefined || result === null
                ? undefined
                : {
                      range:
                          result.range === null
                              ? undefined
                              : toRange(result.range),
                      contents: [{ value: result.contents }],
                  };
        },
    });

    monaco.languages.registerSignatureHelpProvider(languageId, {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [')'],
        provideSignatureHelp: async (model, position, token, context) => {
            const entry = entryFor(model, 'signatureHelp');
            const result =
                entry === undefined
                    ? undefined
                    : await ask<SignatureHelpResult>(
                          entry,
                          'signature_help',
                          {
                              lineNumber: position.lineNumber,
                              column: position.column,
                          },
                          {
                              triggerKind: context.triggerKind,
                              ...(context.triggerCharacter === undefined
                                  ? {}
                                  : {
                                        triggerCharacter:
                                            context.triggerCharacter,
                                    }),
                              isRetrigger: context.isRetrigger,
                          },
                          token,
                      );

            if (result === undefined || result === null) {
                return undefined;
            }

            return {
                value: {
                    signatures: result.signatures.map((signature) => ({
                        label: signature.label,
                        documentation:
                            signature.documentation === null
                                ? undefined
                                : { value: signature.documentation },
                        parameters: signature.parameters.map((parameter) => ({
                            label: parameter.label,
                            documentation:
                                parameter.documentation === null
                                    ? undefined
                                    : { value: parameter.documentation },
                        })),
                    })),
                    activeSignature: result.activeSignature,
                    activeParameter: result.activeParameter,
                },
                dispose: () => {},
            };
        },
    });

    monaco.languages.registerDefinitionProvider(languageId, {
        provideDefinition: async (model, position, token) => {
            const entry = entryFor(model, 'definition');
            const targets =
                entry === undefined
                    ? undefined
                    : await ask<DefinitionTarget[]>(
                          entry,
                          'definition',
                          {
                              lineNumber: position.lineNumber,
                              column: position.column,
                          },
                          null,
                          token,
                      );

            if (entry === undefined || targets === undefined) {
                return undefined;
            }

            // * Same file: Monaco jumps itself. Another file or outside the project: a marker URI that the opener below turns into "open this file" or a notice.
            return targets.map((target) => ({
                uri:
                    target.path === entry.path
                        ? model.uri
                        : target.path !== null
                          ? monaco.Uri.from({
                                scheme: TARGET_SCHEME,
                                path: `/${target.path}`,
                            })
                          : monaco.Uri.from({
                                scheme: EXTERNAL_SCHEME,
                                path: `/${target.external ?? ''}`,
                            }),
                range: toRange(target.range),
            }));
        },
    });

    monaco.languages.registerRenameProvider(languageId, {
        resolveRenameLocation: async (model, position, token) => {
            const entry = entryFor(model, 'rename');

            if (entry === undefined) {
                return undefined;
            }

            const word = model.getWordAtPosition(position);
            const wordRange = new monaco.Range(
                position.lineNumber,
                word?.startColumn ?? position.column,
                position.lineNumber,
                word?.endColumn ?? position.column,
            );

            // * A server with no prepare support is answered by Rust with the word at the caret.
            const result = entry.features?.prepareRename
                ? await ask<PrepareRenameResult>(
                      entry,
                      'prepare_rename',
                      {
                          lineNumber: position.lineNumber,
                          column: position.column,
                      },
                      null,
                      token,
                  )
                : {
                      range: {
                          startLineNumber: wordRange.startLineNumber,
                          startColumn: wordRange.startColumn,
                          endLineNumber: wordRange.endLineNumber,
                          endColumn: wordRange.endColumn,
                      },
                      placeholder: word?.word ?? '',
                  };

            return result === undefined || result === null
                ? {
                      range: wordRange,
                      text: '',
                      rejectReason: t('language_server.cannot_rename'),
                  }
                : { range: toRange(result.range), text: result.placeholder };
        },
        provideRenameEdits: async (model, position, newName, token) => {
            const entry = entryFor(model, 'rename');

            if (entry === undefined) {
                return undefined;
            }

            const plan = await ask<RenamePlan>(
                entry,
                'rename',
                { lineNumber: position.lineNumber, column: position.column },
                { newName },
                token,
            );

            if (plan === undefined || plan.files.length === 0) {
                return {
                    edits: [],
                    rejectReason: t('language_server.rename_nothing'),
                };
            }

            if (
                token.isCancellationRequested ||
                !(await entry.confirmRename(plan))
            ) {
                return { edits: [] };
            }

            await applyRename(entry, plan);

            // * Applied above: Monaco must not apply the edits a second time.
            return { edits: [] };
        },
    });

    monaco.languages.registerDocumentFormattingEditProvider(languageId, {
        provideDocumentFormattingEdits: async (model, options, token) => {
            const entry = entryFor(model, 'formatting');
            const edits =
                entry === undefined
                    ? undefined
                    : await ask<TextEdit[]>(
                          entry,
                          'formatting',
                          null,
                          {
                              tabSize: options.tabSize,
                              insertSpaces: options.insertSpaces,
                          },
                          token,
                      );

            return edits === undefined ? undefined : toEdits(edits);
        },
    });
}

/** Registers the providers once; every provider ignores a model that is not in the registry, so with no server running the editor behaves as before. */
export function startLanguageClient() {
    if (started) {
        return;
    }

    started = true;
    LANGUAGE_IDS.forEach(registerFor);

    monaco.editor.registerEditorOpener({
        openCodeEditor: (source, resource, selection) => {
            if (
                resource.scheme !== TARGET_SCHEME &&
                resource.scheme !== EXTERNAL_SCHEME
            ) {
                return false;
            }

            const entry = getEntry(source.getModel());
            const place = (selection ?? {}) as Partial<monaco.IRange> &
                Partial<monaco.IPosition>;
            const line = place.startLineNumber ?? place.lineNumber ?? 1;
            const column = place.startColumn ?? place.column ?? 1;

            if (resource.scheme === EXTERNAL_SCHEME) {
                toast.info(
                    t('language_server.external_definition', {
                        path: resource.path.replace(/^\//, ''),
                    }),
                );
            } else {
                entry?.openTarget(
                    resource.path.replace(/^\//, ''),
                    line,
                    column,
                );
            }

            return true;
        },
    });

    onDocumentSaved((root, path, text) => {
        const entry = [...entries.values()].find(
            (candidate) =>
                candidate.requestRoot === root && candidate.path === path,
        );

        if (entry !== undefined) {
            void ideLanguageServer
                .documentSave(entry.requestRoot, path, text)
                .catch(() => {});
        }
    });

    // * Outside Tauri (the browser build) `listen` throws: the bridge then simply never hears from a server.
    try {
        void ideLanguageServer.onDiagnostics(showDiagnostics).catch(() => {});
        void ideLanguageServer.onStatus(applyStatus).catch(() => {});
    } catch {
        // * No backend: nothing to listen to.
    }
}
