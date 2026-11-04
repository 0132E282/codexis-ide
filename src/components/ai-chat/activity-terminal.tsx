import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export type ActivityEntry = {
    id: number;
    time: string;
    level: 'info' | 'ok' | 'error';
    text: string;
};

// * ANSI colour and symbol of each log level.
const LEVEL = {
    info: { color: '36', prefix: '›' },
    ok: { color: '32', prefix: '✓' },
    error: { color: '31', prefix: '✗' },
} as const;

const THEME = {
    dark: { background: '#09090b', foreground: '#e4e4e7' },
    light: { background: '#fafafa', foreground: '#27272a' },
} as const;


/** * Terminal (a side-panel column, drawn by xterm.js): it logs what this chat page did (sends, repo reads, pull requests) and runs the commands typed on its last line. */
export function ActivityTerminal({
    entries,
    onClear,
    onClose,
    onRun,
    name,
}: {
    entries: ActivityEntry[];
    onClear: () => void;
    onClose: () => void;
    /** Runs a typed command in the open local project; null when there is none (the terminal then only shows the log). */
    onRun: ((command: string) => Promise<void>) | null;
    /** Folder name of the open local project, shown in the shell-style prompt. */
    name: string | null;
}) {
    const prompt = `\x1b[1m${name ?? ''} %\x1b[0m `;
    const promptText = useRef(prompt);

    useEffect(() => {
        promptText.current = prompt;
    }, [prompt]);

    const host = useRef<HTMLDivElement>(null);
    const term = useRef<Terminal | null>(null);
    const lastId = useRef(-1);
    const [ready, setReady] = useState(false);

    // * Typing state lives in refs: xterm's key handler is created once, so it must not close over render values.
    const line = useRef('');
    const history = useRef<string[]>([]);
    const recall = useRef<number | null>(null);
    const running = useRef(false);
    const run = useRef(onRun);

    useEffect(() => {
        run.current = onRun;
    }, [onRun]);

    // * One xterm for the panel's life, sized to its column. Loaded on demand: xterm is browser-only (CommonJS, breaks SSR).
    useEffect(() => {
        const element = host.current;

        if (element === null) {
            return;
        }

        let cancelled = false;
        let cleanup = () => {};

        void Promise.all([
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
        ]).then(([xterm, addon]) => {
            if (cancelled) {
                return;
            }

            const instance = new xterm.Terminal({
                convertEol: true,
                cursorBlink: true,
                cursorStyle: 'bar',
                cursorInactiveStyle: 'none',
                fontSize: 12,
                fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                scrollback: 5000,
                theme: document.documentElement.classList.contains('dark')
                    ? THEME.dark
                    : THEME.light,
            });
            const fit = new addon.FitAddon();

            const setLine = (value: string) => {
                line.current = value;
                instance.write(`\r\x1b[2K${promptText.current}${value}`);
            };

            const browse = (step: -1 | 1) => {
                const list = history.current;
                const next =
                    recall.current === null
                        ? step === -1
                            ? list.length - 1
                            : null
                        : recall.current + step;

                if (next === null || next < 0 || next >= list.length) {
                    recall.current = null;
                    setLine('');

                    return;
                }

                recall.current = next;
                setLine(list[next]);
            };

            const submit = async () => {
                const value = line.current.trim();

                if (value === '') {
                    return;
                }

                history.current.push(value);
                recall.current = null;
                line.current = '';
                instance.write('\r\x1b[2K');
                running.current = true;

                try {
                    await run.current?.(value);
                } finally {
                    running.current = false;

                    if (term.current === instance) {
                        setLine('');
                    }
                }
            };

            instance.onData((data) => {
                if (run.current === null || running.current) {
                    return;
                }

                if (data === '\r') {
                    void submit();
                } else if (data === '\x7f') {
                    if (line.current !== '') {
                        setLine(line.current.slice(0, -1));
                    }
                } else if (data === '\x1b[A') {
                    browse(-1);
                } else if (data === '\x1b[B') {
                    browse(1);
                } else if (data >= ' ' && !data.startsWith('\x1b')) {
                    setLine(line.current + data.replace(/[\r\n]+/g, ' '));
                }
            });

            instance.loadAddon(fit);
            instance.open(element);
            fit.fit();
            instance.focus();
            term.current = instance;
            lastId.current = -1;
            setReady(true);

            const observer = new ResizeObserver(() => fit.fit());

            observer.observe(element);

            cleanup = () => {
                observer.disconnect();
                instance.dispose();
                term.current = null;
            };
        });

        return () => {
            cancelled = true;
            cleanup();
            setReady(false);
        };
    }, []);

    // * Writes the entries it has not shown yet above the prompt line; an emptied log clears the screen.
    useEffect(() => {
        const instance = term.current;

        if (!ready || instance === null) {
            return;
        }

        if (entries.length === 0) {
            instance.reset();
            instance.writeln('\x1b[90mChưa có hoạt động nào.\x1b[0m');
            lastId.current = -1;
        } else {
            if (lastId.current === -1) {
                instance.reset();
            }

            instance.write('\r\x1b[2K');

            for (const entry of entries) {
                if (entry.id <= lastId.current) {
                    continue;
                }

                // * A run command is echoed like a shell line (`name % command`), the rest as a coloured log line.
                if (entry.text.startsWith('$ ')) {
                    instance.writeln(
                        `${promptText.current}${entry.text.slice(2)}`,
                    );
                    lastId.current = entry.id;

                    continue;
                }

                const { color, prefix } = LEVEL[entry.level];

                instance.writeln(
                    `\x1b[90m${entry.time}\x1b[0m \x1b[${color}m${prefix}\x1b[0m ${entry.text}`,
                );
                lastId.current = entry.id;
            }
        }

        if (onRun !== null) {
            instance.write(`${promptText.current}${line.current}`);
        }
    }, [entries, ready, onRun, prompt]);

    return (
        // * Fills the side panel it sits in (a column beside the chat, like an editor's terminal dock).
        <section
            aria-label="Nhật ký hoạt động"
            className="flex h-full min-h-0 flex-col bg-zinc-50 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
        >
            <header className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-200 px-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <span>
                    Terminal
                    {onRun === null && ' · mở một dự án local để chạy lệnh'}
                </span>
                <span className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Xoá nhật ký"
                        onClick={onClear}
                        className="size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        <Trash2 aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Đóng terminal"
                        onClick={onClose}
                        className="size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        <X aria-hidden="true" />
                    </Button>
                </span>
            </header>
            {/* * xterm sits out of flow so its fitted pixel width never feeds back into the column's own width (which made the panel grow by itself). */}
            <div className="relative min-h-0 min-w-0 flex-1">
                <div
                    ref={host}
                    role="log"
                    aria-live="polite"
                    className="absolute inset-0 overflow-hidden px-3 py-2"
                />
            </div>
        </section>
    );
}
