import * as monaco from 'monaco-editor';
import type { editor } from 'monaco-editor';
import { useEffect } from 'react';
import { languageOf } from '@/components/ai-chat/monaco-setup';
import { ide } from '@/lib/ide';

const LINTED = new Set(['javascript', 'typescript']);
/** Typing pauses this long before the text is checked, so a burst of keys costs one run. */
const LINT_DELAY_MS = 600;
const OWNER = 'eslint';

/**
 * Shows the problems of the project's own ESLint in the editor as you type (red and yellow underlines, also in the Problems of the gutter).
 * The text goes to `eslint --stdin` in Rust; a file the project has no ESLint for simply shows nothing. Nothing here blocks typing or saving: every failure is swallowed.
 */
export function useEslint({
    instance,
    root,
    path,
}: {
    instance: editor.IStandaloneCodeEditor | null;
    root: string | null;
    path: string;
}) {
    useEffect(() => {
        const model = instance?.getModel() ?? null;

        if (model === null || root === null || !LINTED.has(languageOf(path))) {
            return;
        }

        let timer: number | undefined;
        let disposed = false;
        let latest = 0;

        const run = () => {
            const request = ++latest;
            const version = model.getVersionId();

            ide.lintCode(path, model.getValue(), root)
                .then((messages) => {
                    // * An answer for text that has changed since, or for a file that is closed, is dropped: the next run covers it.
                    if (
                        disposed ||
                        request !== latest ||
                        version !== model.getVersionId()
                    ) {
                        return;
                    }

                    monaco.editor.setModelMarkers(
                        model,
                        OWNER,
                        messages.map((message) => ({
                            startLineNumber: message.line,
                            startColumn: message.column,
                            endLineNumber: message.endLine,
                            endColumn: message.endColumn,
                            severity:
                                message.severity === 2
                                    ? monaco.MarkerSeverity.Error
                                    : monaco.MarkerSeverity.Warning,
                            message: message.message,
                            source: 'eslint',
                            code: message.rule ?? undefined,
                        })),
                    );
                })
                .catch(() => undefined);
        };

        const listener = model.onDidChangeContent(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(run, LINT_DELAY_MS);
        });

        run();

        return () => {
            disposed = true;
            window.clearTimeout(timer);
            listener.dispose();

            if (!model.isDisposed()) {
                monaco.editor.setModelMarkers(model, OWNER, []);
            }
        };
    }, [instance, root, path]);
}
