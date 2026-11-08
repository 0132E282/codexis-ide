import { referenceLabel } from '@/lib/code-reference';
import { rememberEditorCopy } from '@/lib/editor-copy';
import { createRoot } from 'react-dom/client';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { InlineAsk } from '@/components/ai-chat/inline-ask';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';
import { Editor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor, Range } from 'monaco-editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiChatActivityStep } from '@/types';
import { lineChanges } from '@/lib/line-changes';
import type { Hunk } from '@/lib/line-changes';
import { revertEdit } from '@/components/ai-chat/hunk-revert';
import {
    READ_ONLY_OPTIONS,
    languageOf,
    monacoTheme,
} from '@/components/ai-chat/monaco-setup';
import { t } from '@/lib/i18n';
import { useLanguageServer } from '@/components/ai-chat/code-viewer/use-language-server';
import { useEslint } from './code-viewer/use-eslint';
import { useBlameAnnotation } from '@/components/ai-chat/blame-annotation';
import type { GitBlameLine } from '@/lib/ide';
import type { CursorStore } from '@/components/ai-chat/code-viewer/cursor-position';
import type { EditorOptions } from '@/components/ai-chat/code-viewer/use-editor-options';

const noopOpen = () => {};

/** * Monaco editor for one file (loaded lazily by the code viewer): read-only unless `onChange` is given, then Cmd/Ctrl+S calls `onSave`. */
export default function MonacoCode({
    path,
    value,
    onChange,
    onSave,
    onAsk,
    onInlineAsk,
    assistant,
    askTrigger,
    baseline,
    boxHost,
    revealLine,
    blame,
    editorOptions,
    cursorStore,
    languageServer,
}: {
    path: string;
    value: string;
    /** * The project's language servers: `root` of the project and where a definition in another file opens (the viewer jumps there). */
    languageServer?: {
        root: string | null;
        onOpenDefinition: (path: string, line: number, column: number) => void;
    };
    /** * Git blame of the file: the line the caret is on shows its author, time and subject (null: nothing shown). */
    blame?: GitBlameLine[] | null;
    /** * The options menu's choices: wrap, guides, whitespace, scroll past end, tab size, Tab key. */
    editorOptions?: EditorOptions;
    /** * Receives the caret's line, column and selection size (the viewer's cursor label reads it). */
    cursorStore?: CursorStore;
    /** * Scrolls the editor to this line once (the id makes the same line scroll again): where the AI changed the file. */
    revealLine?: { line: number; count: number; id: number } | null;
    onChange?: (value: string) => void;
    onSave?: () => void;
    /** * The file as it is in git HEAD: lines that differ get a mark in the margin. */
    baseline?: string | null;
    /** * Adds "Chat với AI" to the right-click menu: called with the selected lines. */
    onAsk?: (selection: {
        startLine: number;
        endLine: number;
        text: string;
    }) => void;
    /** * Name and avatar shown on the answers of the comment box. */
    assistant?: AssistantIdentity;
    /** * Element the comment boxes float in (over the editor and over a diff shown in its place); without it they are overlay widgets of the editor. */
    boxHost?: { current: HTMLElement | null };
    /** * Filled with a function that asks about the selection (the whole file when nothing is selected): the viewer's header button calls it. */
    askTrigger?: { current: (() => void) | null };
    /** * When set, "Chat với AI về đoạn này" opens a comment box under the lines and answers there, instead of calling onAsk. */
    onInlineAsk?: (
        selection: { startLine: number; endLine: number; text: string },
        question: string,
        conversation: string | null,
        signal: AbortSignal,
        onStep: (step: AiChatActivityStep) => void,
        files: File[],
    ) => Promise<InlineAnswer>;
}) {
    const editable = onChange !== undefined;
    // * The editor outlives renders: its save command always calls the newest handler.
    const saveRef = useRef(onSave);

    saveRef.current = onSave;
    const pathRef = useRef(path);

    pathRef.current = path;
    const askRef = useRef(onAsk);

    askRef.current = onAsk;
    const inlineRef = useRef(onInlineAsk);

    inlineRef.current = onInlineAsk;
    // * The comment boxes open right now (several at once, each on its own lines).
    const openBoxes = useRef(new Set<() => void>());
    // * The lock of the box on screen: only one comment box exists at a time.
    const activeLock = useRef<{ current: boolean } | null>(null);
    // * Shows or hides the avatar by the selection (set once the editor is mounted).
    const syncHintRef = useRef<() => void>(() => {});
    const assistantRef = useRef(assistant);

    assistantRef.current = assistant;
    const monacoRef = useRef<Monaco | null>(null);
    const [instance, setInstance] =
        useState<editor.IStandaloneCodeEditor | null>(null);

    useBlameAnnotation(instance, blame ?? null);

    // * ESLint underlines (editable local files only; a file the project cannot lint shows none).
    useEslint({
        instance: editable ? instance : null,
        root: languageServer?.root ?? null,
        path,
    });

    const { active: serverActive, dialog: serverDialog } = useLanguageServer({
        instance: editable ? instance : null,
        root: languageServer?.root ?? null,
        path,
        onOpenDefinition: languageServer?.onOpenDefinition ?? noopOpen,
    });

    // * The caret's place goes to the store at most once per frame; nothing here sets React state.
    useEffect(() => {
        if (instance === null || cursorStore === undefined) {
            return;
        }

        let frame = 0;
        const publish = () => {
            frame = 0;

            const position = instance.getPosition();
            const selection = instance.getSelection();
            const model = instance.getModel();

            if (position === null || model === null) {
                cursorStore.set(null);

                return;
            }

            cursorStore.set({
                line: position.lineNumber,
                column: position.column,
                selectedChars:
                    selection === null || selection.isEmpty()
                        ? 0
                        : model.getValueLengthInRange(selection),
                selectedLines:
                    selection === null || selection.isEmpty()
                        ? 0
                        : selection.endLineNumber -
                          selection.startLineNumber +
                          1,
            });
        };
        const schedule = () => {
            if (frame === 0) {
                frame = window.requestAnimationFrame(publish);
            }
        };
        const subscriptions = [
            instance.onDidChangeCursorPosition(schedule),
            instance.onDidChangeCursorSelection(schedule),
        ];

        publish();

        return () => {
            window.cancelAnimationFrame(frame);
            for (const subscription of subscriptions) {
                subscription.dispose();
            }
            cursorStore.set(null);
        };
    }, [instance, cursorStore]);

    useEffect(() => {
        if (
            instance === null ||
            revealLine === undefined ||
            revealLine === null
        ) {
            return;
        }

        let glow: ReturnType<
            typeof instance.createDecorationsCollection
        > | null = null;
        let glowTimer: number | undefined;

        // * A tick later, so the file text that just arrived is in the editor.
        const timer = window.setTimeout(() => {
            const line = Math.min(
                Math.max(1, revealLine.line),
                instance.getModel()?.getLineCount() ?? 1,
            );

            instance.revealLineInCenter(line);
            instance.setPosition({ lineNumber: line, column: 1 });

            // * The lines the AI wrote glow for a moment, so the eye finds them.
            glow = instance.createDecorationsCollection([
                {
                    range: {
                        startLineNumber: line,
                        startColumn: 1,
                        endLineNumber: Math.min(
                            line + Math.max(1, revealLine.count) - 1,
                            instance.getModel()?.getLineCount() ?? line,
                        ),
                        endColumn: 1,
                    },
                    options: { isWholeLine: true, className: 'pm-ai-glow' },
                },
            ]);

            glowTimer = window.setTimeout(() => glow?.clear(), 2600);
        }, 60);

        return () => {
            window.clearTimeout(timer);
            window.clearTimeout(glowTimer);
            glow?.clear();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instance, revealLine?.id, value.length > 0]);

    useEffect(() => {
        if (instance === null || baseline === undefined || baseline === null) {
            return;
        }

        const collection = instance.createDecorationsCollection();
        let timer: number | undefined;
        let hunks: Hunk[] = [];
        let popup: editor.IContentWidget | null = null;

        const closePopup = () => {
            if (popup !== null) {
                instance.removeContentWidget(popup);
                popup = null;
            }
        };

        // * Puts one block back as it is in git HEAD, as an ordinary edit (undo brings it back; the file is saved when the person saves).
        const revert = (hunk: Hunk) => {
            const model = instance.getModel();

            if (model === null) {
                return;
            }

            instance.executeEdits('pm-revert', [revertEdit(model, hunk)]);
            instance.pushUndoStop();
        };

        // * A click on a change mark in the margin offers to revert that block (like the git margin of an editor).
        const click = instance.onMouseDown((event) => {
            const monaco = monacoRef.current;

            closePopup();

            if (
                monaco === null ||
                event.target.type !==
                    monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
                event.target.position === null
            ) {
                return;
            }

            const line = event.target.position.lineNumber;
            const total = instance.getModel()?.getLineCount() ?? 0;
            const hunk = hunks.find((item) =>
                item.count === 0
                    ? Math.min(item.start + 1, total) === line
                    : line > item.start && line <= item.start + item.count,
            );

            if (hunk === undefined) {
                return;
            }

            const node = document.createElement('button');

            node.type = 'button';
            node.className = 'pm-revert-pop';
            node.textContent = `\u21B6 ${t('monaco_code.undo_this_section')}`;
            node.onclick = () => {
                closePopup();
                revert(hunk);
            };
            popup = {
                getId: () => 'pm.revert-hunk',
                getDomNode: () => node,
                getPosition: () => ({
                    position: { lineNumber: line, column: 1 },
                    preference: [
                        monaco.editor.ContentWidgetPositionPreference.BELOW,
                    ],
                }),
            };
            instance.addContentWidget(popup);
        });

        const paint = () => {
            const changes = lineChanges(baseline, instance.getValue());

            hunks = changes.hunks;
            const rows = (
                lines: number[],
                className: string,
            ): editor.IModelDeltaDecoration[] =>
                lines.map((line) => ({
                    range: {
                        startLineNumber: line,
                        startColumn: 1,
                        endLineNumber: line,
                        endColumn: 1,
                    },
                    options: {
                        isWholeLine: true,
                        linesDecorationsClassName: className,
                    },
                }));

            collection.set([
                ...rows(changes.added, 'pm-gutter-added'),
                ...rows(changes.modified, 'pm-gutter-modified'),
                ...rows(changes.deleted, 'pm-gutter-deleted'),
            ]);
        };

        paint();
        // * Typing repaints once the person pauses, not on every key.
        const listener = instance.onDidChangeModelContent(() => {
            closePopup();
            window.clearTimeout(timer);
            timer = window.setTimeout(paint, 300);
        });

        return () => {
            window.clearTimeout(timer);
            listener.dispose();
            click.dispose();
            closePopup();
            collection.clear();
        };
    }, [instance, baseline]);

    // * The comment box: a layer floating over the editor (position: absolute, above the lines), just under the picked lines. It pushes nothing: no room is made for it, so the lines and their numbers stay where they are.
    const openInlineAsk = (
        instance: editor.ICodeEditor,
        range: Range | null,
        anchorLine: number,
        selection: { startLine: number; endLine: number; text: string },
        ask: NonNullable<typeof onInlineAsk>,
    ) => {
        // * One chat frame only: while the AI answers in the open box a second one does not open; otherwise the open box is replaced by the new one.
        if (activeLock.current?.current) {
            return;
        }

        [...openBoxes.current].forEach((closeOpen) => closeOpen());

        const node = document.createElement('div');
        const root = createRoot(node);
        const marked = instance.createDecorationsCollection(
            range === null
                ? []
                : [{ range, options: { inlineClassName: 'pm-asked-range' } }],
        );
        // * The asked lines keep their own mark: the selection (and its avatar) steps aside so it does not peek out from behind the box.
        if (range !== null) {
            instance.setPosition(range.getEndPosition());
        }

        const widgetId = `pm.inline-ask.${Date.now()}`;
        // * Under the last picked line, kept inside the editor (it slides up when the answer grows past the bottom).
        const place = () => {
            const {
                contentLeft,
                contentWidth,
                verticalScrollbarWidth,
                height,
            } = instance.getLayoutInfo();

            // * Docked at the bottom of the editor (it grows upward), so it never covers the lines being asked about from below and the input stays where the eye rests.
            node.style.left = `${contentLeft}px`;
            node.style.width = `${contentWidth - verticalScrollbarWidth}px`;
            node.style.maxHeight = `${Math.floor(height * 0.8)}px`;
            node.style.top = 'auto';
            node.style.bottom = '8px';
        };

        node.style.position = 'absolute';
        node.style.zIndex = '50';
        node.style.overflowY = 'auto';
        // * The wheel scrolls the box (when its answer is long), not the editor behind it.
        node.addEventListener('wheel', (event) => event.stopPropagation(), {
            passive: true,
        });

        const widget: editor.IOverlayWidget = {
            getId: () => widgetId,
            getDomNode: () => node,
            getPosition: () => null,
        };
        const layout = instance.onDidLayoutChange(place);
        const scroll = instance.onDidScrollChange(place);

        const host = boxHost?.current ?? null;

        if (host === null) {
            instance.addOverlayWidget(widget);
        } else {
            host.appendChild(node);
        }

        place();

        const locked = { current: false };
        activeLock.current = locked;
        // * A click outside the box closes it (not while the AI is answering) (added a tick later, so the click that opened it does not).
        const outside = (event: PointerEvent) => {
            if (!locked.current && !node.contains(event.target as Node)) {
                close();
            }
        };
        const outsideTimer = window.setTimeout(
            () => document.addEventListener('pointerdown', outside, true),
            0,
        );

        const close = () => {
            window.clearTimeout(outsideTimer);
            document.removeEventListener('pointerdown', outside, true);
            openBoxes.current.delete(close);

            if (activeLock.current === locked) {
                activeLock.current = null;
            }

            host?.removeEventListener('pm-close-boxes', close);
            // * First, so the box is gone even when the editor was disposed before it.
            if (host !== null) {
                node.remove();
            }

            // * The editor may be gone already (the file reloaded under the box): its own parts are best effort, the box's React tree always goes.
            try {
                syncHintRef.current();
                layout.dispose();
                scroll.dispose();
                marked.clear();

                if (host === null) {
                    instance.removeOverlayWidget(widget);
                }

                instance.focus();
            } catch {
                // * Disposed with the editor.
            }

            // * Not inside this call: React may be rendering the box that asked to close.
            queueMicrotask(() => root.unmount());
        };

        // * The viewer closes them all at once (an edit decided, another file opened).
        host?.addEventListener('pm-close-boxes', close);
        openBoxes.current.add(close);
        syncHintRef.current();
        root.render(
            <InlineAsk
                label={referenceLabel({
                    path: pathRef.current,
                    ...selection,
                })}
                assistant={assistantRef.current ?? {}}
                ask={(question, conversation, signal, onStep, files) =>
                    ask(
                        selection,
                        question,
                        conversation,
                        signal,
                        onStep,
                        files,
                    )
                }
                onClose={close}
                onHeight={place}
                locked={locked}
            />,
        );
    };

    // * Asks about the lines selected in the editor: the comment box when the page gives one, else the chat takes them as a reference.
    const askSelection = (instance: editor.ICodeEditor) => {
        const range = instance.getSelection();
        const model = instance.getModel();

        if (range === null || model === null) {
            return;
        }

        const inline = inlineRef.current;
        // * Nothing selected: the whole file is what is asked about (startLine 0 means a whole file), the box opens under the cursor.
        const whole = range.isEmpty();
        const selection = whole
            ? { startLine: 0, endLine: 0, text: pathRef.current }
            : {
                  startLine: range.startLineNumber,
                  // * A selection that ends at a line's very start does not include that line.
                  endLine:
                      range.endColumn === 1 &&
                      range.endLineNumber > range.startLineNumber
                          ? range.endLineNumber - 1
                          : range.endLineNumber,
                  text: model.getValueInRange(range),
              };

        if (inline !== undefined) {
            openInlineAsk(
                instance,
                whole ? null : range,
                whole ? range.startLineNumber : selection.endLine,
                selection,
                inline,
            );

            return;
        }

        askRef.current?.(selection);
    };

    // * One options object per real change: a new object on every render would make the editor apply its options (a layout) on every key.
    const isMarkdown = languageOf(path) === 'markdown';
    const monacoOptions = useMemo(
        () => ({
            ...READ_ONLY_OPTIONS,
            readOnly: !editable,
            domReadOnly: !editable,
            // * Markdown is prose: its long lines wrap (keeping their indent) instead of running off the side.
            ...(editorOptions === undefined
                ? {}
                : {
                      wordWrap: editorOptions.wordWrap
                          ? ('on' as const)
                          : ('off' as const),
                      wrappingIndent: 'same' as const,
                      guides: {
                          ...READ_ONLY_OPTIONS.guides,
                          indentation: editorOptions.indentGuides,
                      },
                      renderWhitespace: editorOptions.showWhitespace
                          ? ('all' as const)
                          : ('none' as const),
                      scrollBeyondLastLine: editorOptions.scrollPastEnd,
                      tabSize: editorOptions.tabSize,
                      tabFocusMode: !editorOptions.tabKeyIndents,
                  }),
            // * A running language server answers hover and suggestions: the words of the file are then not offered too.
            ...(serverActive
                ? {
                      hover: { enabled: 'on' as const },
                      wordBasedSuggestions: 'off' as const,
                  }
                : {}),
            ...(isMarkdown
                ? {
                      wordWrap: 'on' as const,
                      wrappingIndent: 'same' as const,
                  }
                : {}),
        }),
        [editable, isMarkdown, editorOptions, serverActive],
    );

    return (
        <>
            {serverDialog}
            <Editor
                path={path}
                value={value}
                language={languageOf(path)}
                theme={monacoTheme()}
                loading={
                    <p className="m-4 text-sm text-muted-foreground">
                        {t('common.loading')}
                    </p>
                }
                onChange={(next) => onChange?.(next ?? '')}
                onMount={(editor, monaco) => {
                    monacoRef.current = monaco;
                    setInstance(editor);
                    // * Remembers what is copied, so pasting it into the chat sends `file:lines` and not the code.
                    editor.getDomNode()?.addEventListener(
                        'copy',
                        () => {
                            const selection = editor.getSelection();
                            const text =
                                selection === null || selection.isEmpty()
                                    ? ''
                                    : (editor
                                          .getModel()
                                          ?.getValueInRange(selection) ?? '');

                            if (selection !== null && text !== '') {
                                rememberEditorCopy(
                                    pathRef.current,
                                    selection.startLineNumber,
                                    selection.endLineNumber,
                                    text,
                                );
                            }
                        },
                        true,
                    );
                    // * The assistant's avatar by a selection: a click asks about the selected lines (like Cmd+L).
                    const hint = document.createElement('div');
                    const hintRoot = createRoot(hint);
                    const hintWidget: editor.IContentWidget = {
                        getId: () => 'pm.ask-hint',
                        getDomNode: () => hint,
                        getPosition: () => {
                            const range = editor.getSelection();

                            return range === null || range.isEmpty()
                                ? null
                                : {
                                      position: range.getEndPosition(),
                                      preference: [
                                          monaco.editor
                                              .ContentWidgetPositionPreference
                                              .BELOW,
                                          monaco.editor
                                              .ContentWidgetPositionPreference
                                              .ABOVE,
                                      ],
                                  };
                        },
                    };
                    let hintShown = false;
                    const syncHint = () => {
                        const range = editor.getSelection();
                        const wanted =
                            range !== null &&
                            !range.isEmpty() &&
                            (inlineRef.current !== undefined ||
                                askRef.current !== undefined);

                        if (wanted && !hintShown) {
                            hintRoot.render(
                                <button
                                    type="button"
                                    title={t('monaco_code.ask_ai_about_this')}
                                    aria-label={t(
                                        'monaco_code.ask_ai_about_this2',
                                    )}
                                    // * The editor must not see the press: it would drop the selection before the click.
                                    onMouseDown={(event) =>
                                        event.preventDefault()
                                    }
                                    onClick={() => askSelection(editor)}
                                    className="ml-2 flex rounded-full shadow-md ring-2 ring-background transition-transform hover:scale-110 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    <AssistantAvatar
                                        {...(assistantRef.current ?? {})}
                                        className="size-6"
                                    />
                                </button>,
                            );
                            editor.addContentWidget(hintWidget);
                            hintShown = true;
                        } else if (wanted) {
                            editor.layoutContentWidget(hintWidget);
                        } else if (hintShown) {
                            editor.removeContentWidget(hintWidget);
                            hintShown = false;
                        }
                    };

                    editor.onDidChangeCursorSelection(syncHint);
                    syncHintRef.current = syncHint;
                    // * The avatar's React tree goes with the editor (not inside this call: React may be rendering).
                    editor.onDidDispose(() => {
                        syncHintRef.current = () => {};
                        queueMicrotask(() => hintRoot.unmount());
                    });

                    if (askTrigger) {
                        askTrigger.current = () => askSelection(editor);
                    }
                    editor.addCommand(
                        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                        () => saveRef.current?.(),
                    );
                    editor.addAction({
                        id: 'pm.chat-about-selection',
                        label: t('monaco_code.chat_with_ai_about'),
                        // * Cmd+L (Ctrl+L), like Cursor; the context menu shows it next to the label.
                        keybindings: [
                            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL,
                        ],
                        contextMenuGroupId: '9_cutcopypaste',
                        contextMenuOrder: 0,
                        precondition: 'editorHasSelection',
                        run: (instance) => askSelection(instance),
                    });
                }}
                options={monacoOptions}
            />
        </>
    );
}
