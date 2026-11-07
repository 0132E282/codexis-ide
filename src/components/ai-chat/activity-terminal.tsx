import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Columns2, SquareTerminal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ide, onTerminalData, onTerminalExit } from '@/lib/ide';
import { cn } from '@/lib/utils';
import { t, translateError } from '@/lib/i18n';

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
                const message =
                    caught instanceof Error ? caught.message : String(caught);

                // * An already open terminal is not an error: keep using it.
                if (message === translateError('terminal.exists')) {
                    instance.focus();

                    return;
                }

                instance.writeln(`\x1b[31m${message}\x1b[0m`);
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

/** The terminal sessions of the bottom panel: kept by the panel so the tab bar (add, split) and the session list share one state. */
export function useTerminalSessions(onClose: () => void) {
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

    const select = (id: number) => {
        setActive(id);
        setSplit((current) => (current === id ? null : current));
    };

    return { terminals, active, split, add, divide, remove, select };
}

export type TerminalSessions = ReturnType<typeof useTerminalSessions>;

/** Terminal tab: the shells on the left, a narrow list of the sessions on the right. */
export function ActivityTerminal({
    sessions,
    root,
    visible,
}: {
    sessions: TerminalSessions;
    /** Folder of the open project (the shells start there). */
    root: string | undefined;
    /** The tab is on screen; the shells stay alive when it is not. */
    visible: boolean;
}) {
    const { terminals, active, split, remove, select, divide } = sessions;
    // * The two terminals shown side by side form a group: listed one under the other with connector lines.
    const rows =
        split === null
            ? terminals
            : [
                  ...terminals.filter((terminal) => terminal.id === active),
                  ...terminals.filter((terminal) => terminal.id === split),
                  ...terminals.filter(
                      (terminal) =>
                          terminal.id !== active && terminal.id !== split,
                  ),
              ];

    return (
        <section
            aria-label="Terminal"
            className={cn(
                'flex h-full min-h-0 bg-zinc-50 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200',
                !visible && 'hidden',
            )}
        >
            <div className="flex min-h-0 min-w-0 flex-1">
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
                                visible &&
                                (terminal.id === active ||
                                    terminal.id === split)
                            }
                            onEnded={() => remove(terminal.id)}
                        />
                    </div>
                ))}
            </div>
            <ul
                aria-label={t('activity_terminal.sessions')}
                className="w-44 shrink-0 overflow-y-auto border-l border-zinc-200 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
            >
                {rows.map((terminal) => {
                    const isActive = terminal.id === active;
                    const isGrouped =
                        split !== null && (isActive || terminal.id === split);
                    const connector = !isGrouped
                        ? null
                        : isActive
                          ? '\u250c'
                          : '\u2514';

                    return (
                        <li
                            key={terminal.id}
                            className={cn(
                                'group flex items-center',
                                isActive &&
                                    'bg-zinc-200 text-zinc-900 ring-1 ring-zinc-400 ring-inset dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-600',
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className="w-4 shrink-0 pl-1.5 font-mono text-zinc-400"
                            >
                                {connector}
                            </span>
                            <button
                                type="button"
                                aria-current={isActive}
                                onClick={() => select(terminal.id)}
                                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                <SquareTerminal
                                    aria-hidden="true"
                                    className="size-3.5 shrink-0"
                                />
                                <span className="truncate">
                                    {terminal.title}
                                </span>
                            </button>
                            <span className="mr-1 hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
                                <button
                                    type="button"
                                    aria-label={t(
                                        'activity_terminal.split_terminal',
                                    )}
                                    onClick={divide}
                                    className="rounded-sm p-1 hover:bg-zinc-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-zinc-700"
                                >
                                    <Columns2
                                        aria-hidden="true"
                                        className="size-3"
                                    />
                                </button>
                                <button
                                    type="button"
                                    aria-label={t(
                                        'activity_terminal.close_title',
                                        {
                                            title: terminal.title,
                                        },
                                    )}
                                    onClick={() => remove(terminal.id)}
                                    className="rounded-sm p-1 hover:bg-zinc-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-zinc-700"
                                >
                                    <Trash2
                                        aria-hidden="true"
                                        className="size-3"
                                    />
                                </button>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
