import { Children, isValidElement, useMemo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChoiceCard } from '@/components/ai-chat/choice-card';
import type { ChoiceHandlers } from '@/components/ai-chat/choice-card';
import { CodeBlock } from '@/components/ai-chat/code-block';
import { FileBlock } from '@/components/ai-chat/file-card';
import { parseChoices } from '@/lib/choices-parser';
import { parseDiff } from '@/lib/diff-parser';
import type { DiffRow } from '@/lib/diff-parser';
import { cn } from '@/lib/utils';

const ALLOWED_URL = /^(https?:|mailto:)/i;

/** * Only http/https/mailto links survive; anything else (relative, javascript:, data:, irc:...) is dropped. */
function transformUrl(url: string): string {
    const safe = defaultUrlTransform(url);

    return ALLOWED_URL.test(safe) ? safe : '';
}

const LANGUAGE_CLASS = /(?:^|\s)language-([^\s]+)/;
const META_TITLE = /(?:title|file|path)=(?:"([^"]*)"|'([^']*)'|(\S+))/;
const DIFF_LANGUAGES = new Set(['diff', 'patch']);

type CodeInfo = {
    title: string;
    /** Name from the block's `title="..."` meta only (never the language fallback). */
    name: string | null;
    code: string;
    language: string | undefined;
    diffRows: DiffRow[] | null;
};

/** First +++ b/path (or --- a/path) of a diff, ignoring /dev/null. */
function diffFileName(rows: DiffRow[]): string | null {
    for (const prefix of ['+++ ', '--- ']) {
        const row = rows.find(
            (candidate) =>
                candidate.kind === 'file' && candidate.text.startsWith(prefix),
        );
        const path = row?.text
            .slice(prefix.length)
            .split('\t')[0]
            .trim()
            .replace(/^[ab]\//, '');

        if (path && path !== '/dev/null') {
            return path;
        }
    }

    return null;
}

/** Title (file name > language > "code"), raw source and parsed diff rows for a fenced block; null if <pre> has no plain-text code child. */
function readCodeBlock(
    children: ReactNode,
    node: ExtraProps['node'],
): CodeInfo | null {
    const child = Children.toArray(children)[0];

    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
        return null;
    }

    const { className, children: code } = child.props;

    if (typeof code !== 'string') {
        return null;
    }

    const language = LANGUAGE_CLASS.exec(className ?? '')?.[1]?.toLowerCase();
    const codeNode = node?.children[0];
    const meta =
        codeNode?.type === 'element' && typeof codeNode.data?.meta === 'string'
            ? codeNode.data.meta
            : '';
    const titleMatch = META_TITLE.exec(meta);
    const metaTitle = titleMatch?.[1] ?? titleMatch?.[2] ?? titleMatch?.[3];
    const diffRows =
        language && DIFF_LANGUAGES.has(language) ? parseDiff(code) : null;
    const title =
        metaTitle || (diffRows && diffFileName(diffRows)) || language || 'code';

    return { title, name: metaTitle ?? null, code, language, diffRows };
}

const baseComponents: Components = {
    h1: ({ node: _node, className, ...props }) => (
        <h1
            className={cn('mt-4 mb-2 text-lg font-semibold', className)}
            {...props}
        />
    ),
    h2: ({ node: _node, className, ...props }) => (
        <h2
            className={cn('mt-4 mb-2 text-base font-semibold', className)}
            {...props}
        />
    ),
    h3: ({ node: _node, className, ...props }) => (
        <h3
            className={cn('mt-4 mb-2 text-sm font-semibold', className)}
            {...props}
        />
    ),
    h4: ({ node: _node, className, ...props }) => (
        <h4
            className={cn('mt-3 mb-1.5 text-sm font-semibold', className)}
            {...props}
        />
    ),
    h5: ({ node: _node, className, ...props }) => (
        <h5
            className={cn('mt-3 mb-1.5 text-sm font-medium', className)}
            {...props}
        />
    ),
    h6: ({ node: _node, className, ...props }) => (
        <h6
            className={cn(
                'mt-3 mb-1.5 text-sm font-medium text-muted-foreground',
                className,
            )}
            {...props}
        />
    ),
    p: ({ node: _node, className, ...props }) => (
        <p className={cn('my-2', className)} {...props} />
    ),
    ul: ({ node: _node, className, ...props }) => (
        <ul className={cn('my-2 list-disc pl-5', className)} {...props} />
    ),
    ol: ({ node: _node, className, ...props }) => (
        <ol className={cn('my-2 list-decimal pl-5', className)} {...props} />
    ),
    li: ({ node: _node, className, ...props }) => (
        <li className={cn('my-1', className)} {...props} />
    ),
    blockquote: ({ node: _node, className, ...props }) => (
        <blockquote
            className={cn(
                'my-3 border-l-2 border-border pl-3 text-muted-foreground',
                className,
            )}
            {...props}
        />
    ),
    hr: ({ node: _node, className, ...props }) => (
        <hr className={cn('my-4 border-border', className)} {...props} />
    ),
    a: ({ node: _node, className, ...props }) => (
        <a
            className={cn(
                'font-medium break-all text-primary underline underline-offset-2 hover:opacity-80',
                className,
            )}
            target="_blank"
            rel="noreferrer noopener"
            {...props}
        />
    ),
    // * Remote images would auto-load (tracking/leaks): show the alt text as a plain link instead.
    img: ({ node: _node, src, alt }) =>
        typeof src === 'string' && src !== '' ? (
            <a
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium break-all text-primary underline underline-offset-2 hover:opacity-80"
            >
                {alt || src}
            </a>
        ) : (
            <span>{alt}</span>
        ),
    code: ({ node: _node, className, ...props }) => (
        // * Fenced blocks carry a `language-*` class (or sit inside <pre>); inline code gets the pill style.
        <code
            className={cn(
                !className &&
                    'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-xs',
                className,
            )}
            {...props}
        />
    ),
    table: ({ node: _node, className, ...props }) => (
        <div className="my-3 overflow-x-auto rounded-lg border border-border">
            <table
                // * Wider than the panel, the table scrolls sideways (its box has overflow-x-auto) instead of squeezing the columns into one word per line.
                className={cn(
                    'w-full min-w-[40rem] border-collapse text-left',
                    className,
                )}
                {...props}
            />
        </div>
    ),
    thead: ({ node: _node, className, ...props }) => (
        <thead className={cn('bg-muted', className)} {...props} />
    ),
    tr: ({ node: _node, className, ...props }) => (
        <tr
            className={cn('border-b border-border last:border-b-0', className)}
            {...props}
        />
    ),
    th: ({ node: _node, className, ...props }) => (
        <th
            className={cn(
                'px-3 py-2 font-semibold whitespace-nowrap',
                className,
            )}
            {...props}
        />
    ),
    td: ({ node: _node, className, ...props }) => (
        <td className={cn('px-3 py-2 align-top', className)} {...props} />
    ),
};

function buildComponents(choiceHandlers?: ChoiceHandlers): Components {
    return {
        ...baseComponents,
        pre: ({ node, className, children, ...props }) => {
            // * Fenced blocks get a title bar + copy button; ```diff / ```patch render as a GitHub-style diff when they parse.
            const info = readCodeBlock(children, node);

            if (info?.language === 'choices' && choiceHandlers) {
                const parsed = parseChoices(info.code);

                // * Anything that is not a strict, valid choices block stays a plain code block.
                if (parsed) {
                    return <ChoiceCard choices={parsed} {...choiceHandlers} />;
                }
            }

            if (!info) {
                return (
                    <pre
                        className={cn(
                            'my-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-relaxed',
                            className,
                        )}
                        {...props}
                    >
                        {children}
                    </pre>
                );
            }

            const block = (
                <CodeBlock
                    title={info.title}
                    code={info.code}
                    diffRows={info.diffRows}
                >
                    {children}
                </CodeBlock>
            );

            // * A block that is a file (named, or a complete svg/html document, or a long block of a known type) becomes a file card; otherwise it stays the plain code block.
            if (!info.diffRows && info.language !== 'diff') {
                return (
                    <FileBlock
                        code={info.code}
                        language={info.language}
                        name={info.name}
                        fallback={block}
                    />
                );
            }

            return block;
        },
    };
}

/** * Renders assistant text as GFM markdown. Raw HTML is not parsed (no rehype-raw), so it stays inert text. */
export function MarkdownContent({
    content,
    choices,
}: {
    content: string;
    /** Enables ```choices cards; without it such a block is a normal code block. */
    choices?: ChoiceHandlers;
}) {
    const components = useMemo(
        () => buildComponents(choices),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [choices?.interactive, choices?.answer, choices?.onChoose],
    );

    return (
        <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={transformUrl}
                components={components}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
