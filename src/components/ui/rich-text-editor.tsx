import Placeholder from '@tiptap/extension-placeholder';
import type { AnyExtension, Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Code } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { LinkBubbleMenu } from '@/components/ui/link-bubble-menu';
import { Toggle } from '@/components/ui/toggle';
import {
    getSource,
    ImageBubbleMenu,
    MarkdownExtension,
    PLUGINS,
} from '@/lib/editor';
import { cn } from '@/lib/utils';

type SourceFormat = 'html' | 'markdown';

/**
 * * Toolbar items come from `PLUGINS` (@/lib/editor/plugins.ts); add new ones there.
 * * `extensions` is for one-off, page-specific plugins.
 */
export function RichTextEditor({
    value,
    onChange,
    placeholder,
    className,
    extensions = [],
    renderToolbar,
}: {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
    className?: string;
    extensions?: AnyExtension[];
    renderToolbar?: (editor: Editor) => ReactNode;
}) {
    const [showSource, setShowSource] = useState(false);
    const [sourceFormat, setSourceFormat] = useState<SourceFormat>('html');
    const [sourceValue, setSourceValue] = useState(value);
    // * Force a re-render on every transaction so toolbar `isActive()` states follow selection changes.
    const [, forceToolbarUpdate] = useState(0);

    const editor = useEditor({
        extensions: [
            // * Replaced by the `orderedList` plugin's extended version (numbering style).
            StarterKit.configure({ orderedList: false }),
            Placeholder.configure({ placeholder: placeholder ?? '' }),
            MarkdownExtension,
            ...PLUGINS.flatMap((plugin) => plugin.extensions ?? []),
            ...extensions,
        ],
        content: value,
        editorProps: {
            attributes: {
                class: 'min-h-30 px-3 py-2 text-sm leading-relaxed focus:outline-none [&.resize-cursor]:cursor-col-resize [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_.tableWrapper]:overflow-x-auto [&_table]:my-2 [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_td]:relative [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:relative [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:font-semibold [&_.column-resize-handle]:pointer-events-none [&_.column-resize-handle]:absolute [&_.column-resize-handle]:top-0 [&_.column-resize-handle]:right-[-2px] [&_.column-resize-handle]:bottom-[-2px] [&_.column-resize-handle]:w-1 [&_.column-resize-handle]:bg-primary/60 [&_hr]:my-3 [&_hr]:border-border [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_.ProseMirror-selectednode]:outline [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-primary [&_.ProseMirror-selectednode]:outline-offset-2 [&_.ProseMirror-selectednode]:rounded-md',
            },
            // ! `openOnClick: false` only covers text links; this also blocks linked images from navigating away while editing.
            handleDOMEvents: {
                click: (_view, event) => {
                    // * Clicks often target a Text node, which has no `.closest()` — use its parent element.
                    const target = event.target as Node;
                    const element =
                        target.nodeType === Node.TEXT_NODE
                            ? target.parentElement
                            : (target as HTMLElement);

                    if (element?.closest('a')) {
                        event.preventDefault();
                    }

                    return false;
                },
            },
        },
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());

            if (!showSource) {
                setSourceValue(getSource(editor, sourceFormat));
            }
        },
        onTransaction: () => forceToolbarUpdate((tick) => tick + 1),
        immediatelyRender: false,
    });

    // * Tiptap reads `content` once; push later `value`s (async load, `form.reset()`) only when they differ.
    useEffect(() => {
        if (editor && value !== editor.getHTML()) {
            editor.commands.setContent(value);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- keeps the source-view textarea in sync with the same externally-set value
            setSourceValue(value);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when the external `value` changes, not on every editor/local-state change
    }, [value]);

    if (!editor) {
        return null;
    }

    return (
        <div
            className={cn(
                'border-input shadow-xs flex flex-col rounded-md border bg-transparent',
                className,
            )}
        >
            <div className="scrollbar-none flex items-center gap-0.5 overflow-x-auto border-b p-1 [-ms-overflow-style:none] *:shrink-0 sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                {PLUGINS.map(
                    ({ name, Toolbar }) =>
                        Toolbar && <Toolbar key={name} editor={editor} />,
                )}

                <Toggle
                    size="sm"
                    pressed={showSource}
                    onPressedChange={(pressed) => {
                        if (pressed) {
                            setSourceValue(getSource(editor, sourceFormat));
                        } else {
                            editor.commands.setContent(sourceValue);
                        }

                        setShowSource(pressed);
                    }}
                    title="Xem mã nguồn"
                >
                    <Code className="size-3.5" />
                </Toggle>

                {showSource && (
                    <select
                        value={sourceFormat}
                        onChange={(event) => {
                            const format = event.target.value as SourceFormat;

                            setSourceFormat(format);
                            setSourceValue(getSource(editor, format));
                        }}
                        className="border-input h-8 rounded-md border bg-transparent px-1.5 text-sm"
                    >
                        <option value="html">HTML</option>
                        <option value="markdown">Markdown</option>
                    </select>
                )}

                {renderToolbar?.(editor)}
            </div>

            {showSource ? (
                <textarea
                    value={sourceValue}
                    onChange={(event) => setSourceValue(event.target.value)}
                    className="min-h-30 max-h-125 w-full resize-none overflow-y-auto bg-transparent p-3 font-mono text-xs focus:outline-none"
                    spellCheck={false}
                />
            ) : (
                <div className="max-h-125 overflow-y-auto">
                    <ImageBubbleMenu editor={editor} />
                    <LinkBubbleMenu editor={editor} />
                    <EditorContent editor={editor} />
                </div>
            )}
        </div>
    );
}
