import { useEffect, useRef } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
    READ_ONLY_OPTIONS,
    languageOf,
    monacoTheme,
} from '@/components/ai-chat/monaco-setup';
import { t } from '@/lib/i18n';

/** * Read-only side-by-side diff (red = removed, green = added) of a file and the AI's proposed version. */
export default function MonacoDiff({
    path,
    original,
    modified,
    typingLine = null,
}: {
    path: string;
    original: string;
    modified: string;
    /** * While the AI "types" the edit: the line being written, kept in view (null: the diff starts from the top). */
    typingLine?: number | null;
}) {
    const diff = useRef<
        | Parameters<
              NonNullable<React.ComponentProps<typeof DiffEditor>['onMount']>
          >[0]
        | null
    >(null);
    const follow = useRef(typingLine);

    follow.current = typingLine;

    useEffect(() => {
        if (typingLine !== null) {
            diff.current
                ?.getModifiedEditor()
                .revealLineInCenterIfOutsideViewport(Math.max(1, typingLine));
        }
    }, [typingLine]);

    return (
        <DiffEditor
            original={original}
            modified={modified}
            originalModelPath={`original/${path}`}
            modifiedModelPath={`modified/${path}`}
            language={languageOf(path)}
            theme={monacoTheme()}
            height="100%"
            onMount={(editor) => {
                diff.current = editor;

                // * The view goes to where the AI changed the file (the first change), not the top; while the edit is typed it follows the typed line instead.
                const top = () => {
                    if (follow.current !== null) {
                        return;
                    }

                    const first = editor.getLineChanges()?.[0];

                    if (first) {
                        editor
                            .getModifiedEditor()
                            .revealLineNearTop(
                                Math.max(1, first.modifiedStartLineNumber - 3),
                            );
                    }
                };

                top();
                editor.onDidUpdateDiff(top);
            }}
            loading={
                <p className="m-4 text-sm text-muted-foreground">
                    {t('common.loading')}
                </p>
            }
            options={{
                ...READ_ONLY_OPTIONS,
                renderSideBySide: false,
                // * Removed lines are drawn inside the one editor (not in a separate box), so selecting text shows the highlight on them too.
                experimental: { useTrueInlineView: true },
                // * The whole file, changed lines highlighted in place (not just the hunks).
                hideUnchangedRegions: { enabled: false },
                enableSplitViewResizing: false,
                renderOverviewRuler: false,
                originalEditable: false,
            }}
        />
    );
}
