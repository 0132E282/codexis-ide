import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { languageOf } from '@/components/ai-chat/monaco-setup';
import { useConfirm } from '@/hooks/use-confirm';
import { ideLanguageServer } from '@/lib/ide-language-server';
import type { DocumentChange, RenamePlan } from '@/lib/ide-language-server';
import {
    attachDocument,
    detachDocument,
    onFeaturesChanged,
    onServerStatus,
    startLanguageClient,
} from '@/lib/language-client';
import type { DocumentEntry } from '@/lib/language-client';
import { t } from '@/lib/i18n';

const SUPPORTED = new Set(['rust', 'php', 'csharp']);
/** Changes of one burst of typing travel together. */
const CHANGE_DELAY_MS = 150;

const toChange = (change: editor.IModelContentChange): DocumentChange => ({
    range: {
        startLineNumber: change.range.startLineNumber,
        startColumn: change.range.startColumn,
        endLineNumber: change.range.endLineNumber,
        endColumn: change.range.endColumn,
    },
    text: change.text,
});

function renameDescription(plan: RenamePlan) {
    const files = plan.files
        .map((file) => `${file.path} (${file.editCount})`)
        .join('; ');
    const skipped = plan.skipped.map((item) => item.display).join('; ');

    return (
        t('language_server.rename_description', { files }) +
        (skipped === ''
            ? ''
            : ` ${t('language_server.rename_skipped', { skipped })}`)
    );
}

/**
 * Tells a language server (rust-analyzer, Intelephense, csharp-ls) about the file in the editor and keeps it in step:
 * open, changes (150 ms bursts, one request at a time), close. The providers live in `language-client`.
 * `active` is true while a server is running for this file. Nothing here blocks typing or saving: every failure is swallowed.
 */
export function useLanguageServer({
    instance,
    root,
    path,
    onOpenDefinition,
}: {
    instance: editor.IStandaloneCodeEditor | null;
    root: string | null;
    path: string;
    onOpenDefinition: (path: string, line: number, column: number) => void;
}): { active: boolean; dialog: ReactNode } {
    const [active, setActive] = useState(false);
    // * Bumped when a server is switched on while this file has none: the file is then opened again.
    const [generation, setGeneration] = useState(0);
    const { confirm, dialog } = useConfirm();
    const confirmRef = useRef(confirm);
    const openRef = useRef(onOpenDefinition);

    // * The editor's callbacks always reach the newest handlers.
    useEffect(() => {
        confirmRef.current = confirm;
        openRef.current = onOpenDefinition;
    });

    useEffect(() => {
        const model = instance?.getModel() ?? null;

        if (
            model === null ||
            root === null ||
            !SUPPORTED.has(languageOf(path))
        ) {
            return;
        }

        startLanguageClient();

        let disposed = false;
        let opened = false;
        let entry: DocumentEntry | null = null;
        let timer: number | undefined;
        let pending: DocumentChange[] = [];
        let chain: Promise<unknown> = Promise.resolve();

        const send = (job: () => Promise<unknown>) => {
            chain = chain.then(job).catch(() => {});

            return chain;
        };

        const flush = () => {
            window.clearTimeout(timer);

            if (pending.length === 0) {
                return chain;
            }

            const changes = pending;

            pending = [];

            return send(async () => {
                try {
                    await ideLanguageServer.documentChange(root, path, changes);
                } catch {
                    // * Out of step: the whole text replaces what the server has.
                    await ideLanguageServer
                        .documentChange(root, path, [
                            { range: null, text: model.getValue() },
                        ])
                        .catch(() => {});
                }
            });
        };

        const listener = model.onDidChangeContent((event) => {
            pending = event.isFlush
                ? [{ range: null, text: model.getValue() }]
                : [...pending, ...event.changes.map(toChange)];
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void flush(), CHANGE_DELAY_MS);
        });

        const opening = ideLanguageServer
            .documentOpen(root, path, model.getValue())
            .catch(() => null);

        send(async () => {
            const result = await opening;

            if (result === null) {
                return;
            }

            opened = true;

            if (disposed) {
                void ideLanguageServer
                    .documentClose(root, path)
                    .catch(() => {});

                return;
            }

            const created: DocumentEntry = {
                model,
                requestRoot: root,
                root: result.root,
                path,
                serverId: result.serverId,
                features: result.features,
                flush,
                confirmRename: (plan) =>
                    confirmRef.current({
                        title: t('language_server.rename_title'),
                        description: renameDescription(plan),
                        action: t('language_server.rename_action'),
                    }),
                openTarget: (target, line, column) =>
                    openRef.current(target, line, column),
            };
            entry = created;
            attachDocument(created);
            setActive(result.features !== null);
        });

        const stopFeatures = onFeaturesChanged(() =>
            setActive(entry !== null && entry.features !== null),
        );
        const stopStatus = onServerStatus((event) => {
            if (entry === null && event.enabled && event.state !== 'missing') {
                setGeneration((current) => current + 1);
            }
        });

        return () => {
            disposed = true;
            window.clearTimeout(timer);
            listener.dispose();
            stopFeatures();
            stopStatus();
            detachDocument(model);

            if (opened) {
                void ideLanguageServer
                    .documentClose(root, path)
                    .catch(() => {});
            }

            setActive(false);
        };
    }, [instance, root, path, generation]);

    return { active, dialog };
}
