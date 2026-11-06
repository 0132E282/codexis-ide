import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Columns2, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ide, onTerminalData, onTerminalExit } from '@/lib/ide';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const THEME = {
    dark: { background: '#09090b', foreground: '#e4e4e7' },
    light: { background: '#fafafa', foreground: '#27272a' },
} as const;

/** Unique per mount, so a shell that is still closing never shares its id with the one that replaces it. */
let sessionCounter = 0;

/** One real shell in the project folder, drawn by xterm.js; everything typed goes straight to it. */
function ShellTerminal({
    root,
    visible,
    onEnded,
}: {
    root: string | undefined;
    /** Hidden terminals stay alive (their shell goes on) but are not drawn. */
    visible: boolean;
    onEnded: () => void;
}) {
    const host = useRef<HTMLDivElement>(null);
    const refit = useRef<() => void>(() => undefined);
    const ended = useRef(onEnded);

    useEffect(() => {
        ended.current = onEnded;
    }, [onEnded]);

    useEffect(() => {
        if (visible) {
            refit.current();
        }
    }, [visible]);

    useEffect(() => {
        const element = host.current;

        if (element === null) {
            return;
        }

        const sessionId = `shell-${sessionCounter++}`;
        let cancelled = false;
        let cleanup = () => {};

        void Promise.all([
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
        ]).then(async ([xterm, addon]) => {
            if (cancelled) {
                return;
            }

            const instance: Terminal = new xterm.Terminal({
                cursorBlink: true,
                fontSize: 12,
                fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                scrollback: 5000,
                theme: document.documentElement.classList.contains('dark')
                    ? THEME.dark
                    : THEME.light,
            });
            const fit = new addon.FitAddon();

            instance.loadAddon(fit);
            instance.open(element);

            const fitNow = () => {
                // * A hidden terminal has no size to fit to.
                if (element.offsetWidth === 0 || element.offsetHeight === 0) {
                    return;
                }

                fit.fit();
                void ide
                    .terminalResize(sessionId, instance.cols, instance.rows)
                    .catch(() => undefined);
            };

            fit.fit();
            refit.current = fitNow;

            const stops = await Promise.all([
                onTerminalData((event) => {
                    if (event.id === sessionId) {
                        instance.write(event.data);
                    }
                }),
                onTerminalExit((id) => {
                    if (id === sessionId) {
                        instance.writeln(
                            `\r\n\x1b[90m[${t('activity_terminal.shell_exited')}]\x1b[0m`,
                        );
                        ended.current();
                    }
                }),
            ]);

            const input = instance.onData((data) => {
                void ide.terminalWrite(sessionId, data).catch(() => undefined);
            });
            const observer = new ResizeObserver(fitNow);

            observer.observe(element);

            cleanup = () => {
                observer.disconnect();
                input.dispose();
                stops.forEach((stop) => stop());
                void ide.terminalClose(sessionId).catch(() => undefined);
                instance.dispose();
            };

            if (cancelled) {
                cleanup();

                return;
            }

            try {
                await ide.terminalOpen(
                    sessionId,
                    instance.cols,
                    instance.rows,
                    root,
                );
                instance.focus();
            } catch (caught) {
                instance.writeln(
                    `\x1b[31m${caught instanceof Error ? caught.message : String(caught)}\x1b[0m`,
                );
            }
        });

        return () => {
            cancelled = true;
            cleanup();
        };
    }, [root]);

    return (
        // * xterm sits out of flow so its fitted pixel width never feeds back into the width of the column.
        <div
            className={cn(
                'relative min-h-0 min-w-0 flex-1',
                !visible && 'hidden',
            )}
        >
            <div
                ref={host}
                className="absolute inset-0 overflow-hidden px-3 py-2"
            />
        </div>
    );
}

/** Terminal panel: real shells of this machine in the open project, several at once, and two side by side. */
export function ActivityTerminal({
    onClose,
    root,
}: {
    onClose: () => void;
    /** Folder of the open project (the shells start there). */
    root: string | undefined;
}) {
    const counter = useRef(2);
    const [terminals, setTerminals] = useState([
        { id: 1, title: 'Terminal 1' },
    ]);
    const [active, setActive] = useState(1);
    // * The terminal drawn beside the active one (null: only one on screen).
    const [split, setSplit] = useState<number | null>(null);

    const add = () => {
        const id = counter.current++;

        setTerminals((current) => [
            ...current,
            { id, title: `Terminal ${id}` },
        ]);
        setActive(id);
    };

    const divide = () => {
        if (split !== null) {
            setSplit(null);

            return;
        }

        const other = terminals.find((terminal) => terminal.id !== active);

        if (other !== undefined) {
            setSplit(other.id);

            return;
        }

        const id = counter.current++;

        setTerminals((current) => [
            ...current,
            { id, title: `Terminal ${id}` },
        ]);
        setSplit(id);
    };

    const remove = (id: number) => {
        const left = terminals.filter((terminal) => terminal.id !== id);

        if (left.length === 0) {
            onClose();

            return;
        }

        setTerminals(left);

        if (split === id) {
            setSplit(null);
        }

        if (active === id) {
            const next =
                left.find((terminal) => terminal.id !== split) ?? left[0];

            setActive(next.id);
            setSplit((current) => (current === next.id ? null : current));
        }
    };

    return (
        // * Fills the side panel it sits in (a dock below the editor, like an editor's terminal).
        <section
            aria-label="Terminal"
            className="flex h-full min-h-0 flex-col bg-zinc-50 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
        >
            <header className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-200 px-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                    {terminals.map((terminal) => (
                        <span
                            key={terminal.id}
                            className={cn(
                                'flex shrink-0 items-center rounded-sm',
                                (terminal.id === active ||
                                    terminal.id === split) &&
                                    'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setActive(terminal.id);
                                    setSplit((current) =>
                                        current === terminal.id
                                            ? null
                                            : current,
                                    );
                                }}
                                className="px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                {terminal.title}
                            </button>
                            <button
                                type="button"
                                aria-label={t('activity_terminal.close_title', {
                                    title: terminal.title,
                                })}
                                onClick={() => remove(terminal.id)}
                                className="rounded-sm p-1 hover:bg-zinc-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-zinc-700"
                            >
                                <X aria-hidden="true" className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <span className="flex shrink-0 items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('activity_terminal.add_terminal')}
                        onClick={add}
                        className="size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        <Plus aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('activity_terminal.split_terminal')}
                        aria-pressed={split !== null}
                        onClick={divide}
                        className={cn(
                            'size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                            split !== null && 'bg-zinc-200 dark:bg-zinc-800',
                        )}
                    >
                        <Columns2 aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('activity_terminal.close_terminal')}
                        onClick={onClose}
                        className="size-7 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        <X aria-hidden="true" />
                    </Button>
                </span>
            </header>
            <div className="flex min-h-0 flex-1">
                {terminals.map((terminal) => (
                    <div
                        key={terminal.id}
                        className={cn(
                            'flex min-h-0 min-w-0 flex-1',
                            terminal.id !== active &&
                                terminal.id !== split &&
                                'hidden',
                            terminal.id === split &&
                                'order-last border-l border-zinc-200 dark:border-zinc-800',
                        )}
                    >
                        <ShellTerminal
                            root={root}
                            visible={
                                terminal.id === active || terminal.id === split
                            }
                            onEnded={() => remove(terminal.id)}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}
