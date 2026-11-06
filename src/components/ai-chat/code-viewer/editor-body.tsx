import { lazy, Suspense } from 'react';
import type { ReactNode, RefObject } from 'react';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { LoadingRows } from '@/components/ai-chat/loading-rows';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import { isPdfSource } from '@/lib/media-file';
import { cn } from '@/lib/utils';
import type { AskReference, InlineAskHandler } from './types';
import { typedLines } from './typed-lines';

// * Monaco is heavy: it loads only when a file is opened.
const MonacoCode = lazy(() => import('@/components/ai-chat/monaco-code'));
const MonacoDiff = lazy(() => import('@/components/ai-chat/monaco-diff'));

/** * What the open file shows: the error, a loading skeleton, a PDF, a picture, rendered markdown, or the Monaco editor (with the AI's diff over it). */
export function EditorBody({
    selected,
    fileError,
    content,
    image,
    preview,
    isMarkdown,
    proposed,
    base,
    editable,
    typing,
    draft,
    revealAt,
    revealed,
    baseline,
    boxHost,
    assistant,
    askTrigger,
    onPreviewChange,
    onDraftChange,
    onSave,
    onInlineAsk,
    onAsk,
}: {
    selected: string;
    fileError: string | null;
    content: string | null;
    image: string | null;
    preview: boolean;
    isMarkdown: boolean;
    proposed: string | null;
    base: string | null;
    editable: boolean;
    typing: string | null;
    draft: string | null;
    revealAt: { line: number; count: number; id: number } | null;
    /** * Lines of the AI's diff shown so far (null: all). */
    revealed: number | null;
    baseline: string | null;
    boxHost: RefObject<HTMLDivElement | null>;
    assistant?: AssistantIdentity;
    askTrigger: RefObject<(() => void) | null>;
    onPreviewChange: (preview: boolean) => void;
    onDraftChange: (draft: string | null) => void;
    onSave: () => void;
    onInlineAsk?: InlineAskHandler;
    onAsk?: (reference: AskReference) => void;
}): ReactNode {
    return (
        <>
            {fileError !== null ? (
                <p role="alert" className="m-4 text-sm text-destructive">
                    {fileError}
                </p>
            ) : content === null ? (
                <LoadingRows rows={8} className="px-4 py-4" />
            ) : image !== null && isPdfSource(image) ? (
                <iframe
                    src={image}
                    title={selected}
                    className="min-h-0 flex-1 border-0"
                />
            ) : image !== null ? (
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
                    <img
                        src={image}
                        alt={selected}
                        className="max-h-full max-w-full object-contain rounded-md border bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                    />
                </div>
            ) : preview && isMarkdown && proposed === null ? (
                <div
                    className="min-h-0 flex-1 overflow-auto p-4"
                    // * Editing happens in the code view (the rendered text cannot be written back to markdown without rewriting the file): a double click on the text opens it.
                    onDoubleClick={() => editable && onPreviewChange(false)}
                    title={editable ? 'Bấm đúp để sửa' : undefined}
                >
                    <MarkdownContent content={content} />
                </div>
            ) : (
                <div className="relative min-h-0 flex-1">
                    <Suspense
                        fallback={
                            <p className="m-4 text-sm text-muted-foreground">
                                Đang tải...
                            </p>
                        }
                    >
                        {proposed !== null && (
                            <div className="absolute inset-0 z-10 bg-background">
                                <MonacoDiff
                                    path={selected}
                                    typingLine={revealed}
                                    original={base ?? content}
                                    modified={
                                        revealed === null
                                            ? proposed
                                            : typedLines(
                                                  base ?? content,
                                                  proposed,
                                                  revealed,
                                              )
                                    }
                                />
                            </div>
                        )}
                        {/* * The editor stays mounted under a diff so the comment boxes opened in it keep showing. */}
                        <div
                            className={cn(
                                'absolute inset-0',
                                proposed !== null && 'invisible',
                            )}
                        >
                            <MonacoCode
                                boxHost={boxHost}
                                revealLine={revealAt}
                                path={selected}
                                value={typing ?? draft ?? content}
                                onChange={
                                    editable
                                        ? (next) =>
                                              onDraftChange(
                                                  next === content
                                                      ? null
                                                      : next,
                                              )
                                        : undefined
                                }
                                // * Ctrl/Cmd+S: applies the AI's edit when one is waiting, else saves the typed text now.
                                onSave={onSave}
                                baseline={baseline}
                                assistant={assistant}
                                askTrigger={askTrigger}
                                onInlineAsk={
                                    onInlineAsk
                                        ? (range, ...rest) =>
                                              onInlineAsk(
                                                  {
                                                      path: selected,
                                                      ...range,
                                                  },
                                                  ...rest,
                                              )
                                        : undefined
                                }
                                onAsk={
                                    onAsk
                                        ? (range) =>
                                              onAsk({
                                                  path: selected,
                                                  ...range,
                                              })
                                        : undefined
                                }
                            />
                        </div>
                    </Suspense>
                </div>
            )}
        </>
    );
}
