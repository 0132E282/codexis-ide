import { useEffect, useMemo, useRef, useState } from 'react';
import { FileIcon } from '@/components/ai-chat/file-icon';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const MAX_RESULTS = 50;

/** * Rank of `path` for the typed text, or null when it does not match: the letters must appear in order; a hit in the file name, a start of the name and a tight run score higher. */
function rank(path: string, query: string): number | null {
    const lower = path.toLowerCase();
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    let score = 0;
    let from = 0;
    let previous = -2;

    for (const letter of query) {
        const at = lower.indexOf(letter, from);

        if (at === -1) {
            return null;
        }

        score += at === previous + 1 ? 3 : 1;
        previous = at;
        from = at + 1;
    }

    if (name.includes(query)) {
        score += 20;
    }

    if (name.startsWith(query)) {
        score += 10;
    }

    // * Shorter paths first among equals.
    return score - path.length / 100;
}

/** * "Tìm tệp" (Cmd/Ctrl+P): type to filter the project's files, arrows and Enter (or a click) open one. */
export function QuickOpen({
    open,
    onOpenChange,
    paths,
    onPick,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    paths: string[];
    onPick: (path: string) => void;
}) {
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const list = useRef<HTMLUListElement>(null);

    const results = useMemo(() => {
        const text = query.trim().toLowerCase();

        if (text === '') {
            return paths.slice(0, MAX_RESULTS);
        }

        return paths
            .map((path) => ({ path, score: rank(path, text) }))
            .filter(
                (item): item is { path: string; score: number } =>
                    item.score !== null,
            )
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS)
            .map((item) => item.path);
    }, [paths, query]);

    useEffect(() => {
        if (open) {
            setQuery('');
            setIndex(0);
        }
    }, [open]);

    useEffect(() => {
        list.current
            ?.querySelector('[aria-selected="true"]')
            ?.scrollIntoView({ block: 'nearest' });
    }, [index, results]);

    const pick = (path: string | undefined) => {
        if (path !== undefined) {
            onOpenChange(false);
            onPick(path);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
            >
                <DialogTitle className="sr-only">Tìm tệp</DialogTitle>
                <DialogDescription className="sr-only">
                    Gõ tên tệp, dùng mũi tên và Enter để mở.
                </DialogDescription>
                <Input
                    autoFocus
                    value={query}
                    placeholder="Tìm tệp theo tên…"
                    autoComplete="off"
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setIndex(0);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setIndex((current) =>
                                Math.min(current + 1, results.length - 1),
                            );
                        } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setIndex((current) => Math.max(current - 1, 0));
                        } else if (
                            event.key === 'Enter' &&
                            !event.nativeEvent.isComposing
                        ) {
                            event.preventDefault();
                            pick(results[index]);
                        }
                    }}
                    className="h-12 rounded-none border-0 border-b px-4 shadow-none focus-visible:ring-0"
                />
                <ul
                    ref={list}
                    role="listbox"
                    aria-label="Tệp"
                    className="max-h-80 overflow-y-auto py-1"
                >
                    {results.length === 0 && (
                        <li className="px-4 py-3 text-sm text-muted-foreground">
                            Không có tệp nào khớp.
                        </li>
                    )}
                    {results.map((path, position) => {
                        const name = path.split('/').pop() ?? path;
                        const dir = path.split('/').slice(0, -1).join('/');

                        return (
                            <li
                                key={path}
                                role="option"
                                aria-selected={position === index}
                                onMouseEnter={() => setIndex(position)}
                                onClick={() => pick(path)}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2 px-4 py-1.5 text-sm',
                                    position === index &&
                                        'bg-accent text-accent-foreground',
                                )}
                            >
                                <FileIcon name={name} className="size-4" />
                                <span className="truncate">{name}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {dir}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </DialogContent>
        </Dialog>
    );
}
