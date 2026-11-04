import { Check, Copy, FilePen, Loader2 } from 'lucide-react';
import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { DiffView } from '@/components/ai-chat/diff-view';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { CodeApplyContext, isFilePath } from '@/lib/code-apply';
import type { DiffRow } from '@/lib/diff-parser';
import { requestErrorMessage } from '@/lib/ai-error';

/** * Fenced block frame: title bar (file name, else language, else "code") with a copy button, then the diff view or the plain code. */
export function CodeBlock({
    title,
    code,
    diffRows,
    children,
}: {
    title: string;
    /** Raw source copied to the clipboard (the original diff for diff blocks). */
    code: string;
    diffRows: DiffRow[] | null;
    children: ReactNode;
}) {
    const { copied, copy } = useCopyToClipboard();
    const apply = useContext(CodeApplyContext);
    const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
    // * A whole-file block titled with a project path can be written into that file (the click is the approval).
    const canApply = apply !== null && diffRows === null && isFilePath(title);

    return (
        <div className="my-3 overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
                {/* * Long paths keep their end visible: the start is cut (rtl + bdi, as in the file viewer bar). */}
                <span className="min-w-0 truncate" dir="rtl" title={title}>
                    <bdi>{title}</bdi>
                </span>
                {canApply && (
                    <button
                        type="button"
                        disabled={state === 'busy'}
                        onClick={async () => {
                            setState('busy');

                            try {
                                await apply(title, code);
                                setState('done');
                            } catch (caught) {
                                setState('idle');
                                toast.error(
                                    requestErrorMessage(
                                        caught,
                                        `Không ghi được ${title}.`,
                                    ),
                                );
                            }
                        }}
                        className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                        {state === 'busy' ? (
                            <Loader2
                                className="size-3.5 animate-spin"
                                aria-hidden
                            />
                        ) : state === 'done' ? (
                            <Check className="size-3.5" aria-hidden />
                        ) : (
                            <FilePen className="size-3.5" aria-hidden />
                        )}
                        <span>
                            {state === 'done'
                                ? 'Đã áp dụng'
                                : 'Áp dụng vào tệp'}
                        </span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => copy(code)}
                    aria-label={copied ? 'Đã sao chép' : 'Sao chép đoạn mã'}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    {copied ? (
                        <Check className="size-3.5" aria-hidden />
                    ) : (
                        <Copy className="size-3.5" aria-hidden />
                    )}
                    <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
                </button>
            </div>
            {diffRows ? (
                <DiffView rows={diffRows} />
            ) : (
                <pre className="overflow-x-auto bg-muted p-3 font-mono text-xs leading-relaxed">
                    {children}
                </pre>
            )}
        </div>
    );
}
