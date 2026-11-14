import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Columns2, SquareTerminal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TREE_PATH_MIME } from '@/components/code-viewer/constants';
import { ide, onTerminalData, onTerminalExit } from '@/lib/ide';
import { cn } from '@/lib/utils';
import { t, translateError } from '@/lib/i18n';

/** `path` as one shell word: left as is when it is plain, otherwise in single quotes. */
function shellQuote(path: string): string {
    return /^[\w@%+=:,./-]+$/.test(path)
        ? path
        : `'${path.replaceAll("'", "'\\''")}'`;
}

const THEME = {
    dark: { background: '#09090b', foreground: '#e4e4e7' },
    light: { background: '#fafafa', foreground: '#27272a' },
} as const;

/** Unique per mount, so a shell that is still closing never shares its id with the one that replaces it. */
// * Shell ids are shared by every window (the backend keeps them in one map and the events reach all windows), so each page has its own prefix.
const SESSION_PREFIX = `shell-${crypto.randomUUID().slice(0, 8)}`;
let sessionCounter = 0;

const nextSessionId = () => `${SESSION_PREFIX}-${sessionCounter++}`;

/** The shells of this window that are open, by the id of the terminal that shows them. */
const liveShells = new Map<number, string>();
/** Shells given to another window: they keep running, so closing their terminal here must not end them. */
const handedOffShells = new Set<string>();

/** The ids of the shells this window has open, to take to a separate window. */
export function listShellIds(): string[] {
    return [...liveShells.values()];
}

/** Marks the shells as moved to another window, which now owns them. */
export function markShellsHandedOff(ids: string[]) {
    ids.forEach((id) => handedOffShells.add(id));
}

const MAX_ADOPTED_SHELLS = 16;

/** The shells a separate window was opened with (`?sessions=a,b`): only well-formed ids, no repeats. */
function readAdoptedShellIds(): string[] {
    const asked =
        new URLSearchParams(window.location.search).get('sessions') ?? '';
    const ids = asked
        .split(',')
        .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));

    return [...new Set(ids)].slice(0, MAX_ADOPTED_SHELLS);
}

/** One real shell in the project folder, drawn by xterm.js; everything typed goes straight to it. */
function ShellTerminal({
    terminalId,
    adoptedId,
    root,
    visible,
    onEnded,
}: {
    terminalId: number;
    /** A shell that is already running (taken over from another window): shown again instead of opening a new one. */
    adoptedId: string | undefined;
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

        let sessionId = adoptedId ?? nextSessionId();
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

            let lastResize: { columns: number; rows: number } | null = null;
            const fitNow = () => {
                // * A hidden terminal has no size to fit to.
                if (element.offsetWidth === 0 || element.offsetHeight === 0) {
                    return;
                }

                fit.fit();
                const columns = instance.cols;
                const rows = instance.rows;

                if (
                    lastResize?.columns === columns &&
                    lastResize.rows === rows
                ) {
                    return;
                }

                lastResize = { columns, rows };
                void ide
                    .terminalResize(sessionId, columns, rows)
                    .catch(() => undefined);
            };

            fit.fit();
            refit.current = fitNow;

            // * A shell taken over keeps printing while its screen is rebuilt: what arrives meanwhile waits for the snapshot.
            let waiting: { data: string; end?: number }[] | null =
                adoptedId === undefined ? null : [];
            const stops = await Promise.all([
                onTerminalData((event) => {
                    if (event.id !== sessionId) {
                        return;
                    }

                    if (waiting === null) {
                        instance.write(event.data);
                    } else {
                        waiting.push(event);
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

            // * Each write waits for the one before it: separate invokes may reach the shell out of order, and typing (an IME sends several chunks per key) would come out scrambled or short.
            let writes: Promise<unknown> = Promise.resolve();
            const sendInput = (data: string) => {
                writes = writes
                    .then(() => ide.terminalWrite(sessionId, data))
                    .catch(() => undefined);
            };
            const input = instance.onData(sendInput);
            const observer = new ResizeObserver(fitNow);

            observer.observe(element);

            // * A file or folder dragged from the file tree is typed at the cursor as a path (the shell starts in the project folder, so the relative path fits); it is not run.
            const acceptsDrop = (event: DragEvent) =>
                event.dataTransfer?.types.includes(TREE_PATH_MIME) === true;
            const onDragOver = (event: DragEvent) => {
                if (acceptsDrop(event)) {
                    event.preventDefault();
                }
            };
            const onDrop = (event: DragEvent) => {
                const path = event.dataTransfer?.getData(TREE_PATH_MIME);

                if (!acceptsDrop(event) || !path) {
                    return;
                }

                event.preventDefault();
                sendInput(`${shellQuote(path)} `);
                instance.focus();
            };

            element.addEventListener('dragover', onDragOver);
            element.addEventListener('drop', onDrop);

            cleanup = () => {
                element.removeEventListener('dragover', onDragOver);
                element.removeEventListener('drop', onDrop);
                observer.disconnect();
                input.dispose();
                stops.forEach((stop) => stop());
                liveShells.delete(terminalId);

                if (!handedOffShells.has(sessionId)) {
                    void ide.terminalClose(sessionId).catch(() => undefined);
                }

                instance.dispose();
            };

            if (cancelled) {
                cleanup();

                return;
            }

            if (adoptedId !== undefined) {
                try {
                    const snapshot = await ide.terminalSnapshot(adoptedId);

                    if (cancelled) {
                        return;
                    }

                    instance.write(snapshot.data);

                    // * Chunks the snapshot already holds are not written twice.
                    waiting
                        ?.filter(
                            (event) =>
                                event.end === undefined ||
                                event.end > snapshot.end,
                        )
                        .forEach((event) => instance.write(event.data));
                    waiting = null;
                    liveShells.set(terminalId, sessionId);
                    fitNow();
                    instance.focus();

                    return;
                } catch {
                    if (cancelled) {
                        return;
                    }

                    // * The shell is gone (it ended in between): this terminal starts a new one.
                    waiting = null;
                    sessionId = nextSessionId();
                }
            }

            try {
                await ide.terminalOpen(
                    sessionId,
                    instance.cols,
                    instance.rows,
                    root,
                );
                liveShells.set(terminalId, sessionId);
                instance.focus();
            } catch (caught) {
                const message =
                    caught instanceof Error ? caught.message : String(caught);

                // * An already open terminal is not an error: keep using it.
                if (message === translateError('terminal.exists')) {
                    liveShells.set(terminalId, sessionId);
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
    }, [root, terminalId, adoptedId]);

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
export function useTerminalSessions(
    onClose: () => void,
    root: string | undefined,
) {
    // * A separate window opened with running shells shows them again, one terminal each; otherwise there is one new shell.
    const [firstTerminals] = useState(() => {
        const adopted = readAdoptedShellIds();

        return adopted.length === 0
            ? [{ id: 1, title: 'Terminal 1', root, adoptedId: undefined }]
            : adopted.map((adoptedId, index) => ({
                  id: index + 1,
                  title: `Terminal ${index + 1}`,
                  root,
                  adoptedId: adoptedId as string | undefined,
              }));
    });
    const counter = useRef(firstTerminals.length + 1);
    // * Each shell starts in the folder of the project open when it was made and stays there: switching project leaves it running.
    const [terminals, setTerminals] = useState<
        {
            id: number;
            title: string;
            root: string | undefined;
            adoptedId?: string;
        }[]
    >(firstTerminals);
    const [active, setActive] = useState(1);
    // * The terminal drawn beside the active one (null: only one on screen).
    const [split, setSplit] = useState<number | null>(null);

    const add = () => {
        const id = counter.current++;

        setTerminals((current) => [
            ...current,
            { id, title: `Terminal ${id}`, root },
        ]);
        setActive(id);
    };

    // * The two terminals shown side by side form a group.
    const isInGroup = (id: number) =>
        split !== null && (id === active || id === split);

    // * Split the terminal of the clicked row beside the active one; on a row of the current group it ungroups instead.
    const divide = (rowId: number) => {
        if (isInGroup(rowId)) {
            setSplit(null);

            return;
        }

        if (rowId !== active) {
            setSplit(rowId);

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
            { id, title: `Terminal ${id}`, root },
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

    // * A terminal outside the group is shown alone: it must not pair with the group's split and push the first terminal down the list.
    const select = (id: number) => {
        const keepsGroup = isInGroup(id) && id !== split;

        setActive(id);
        setSplit((current) => (keepsGroup ? current : null));
    };

    return {
        terminals,
        active,
        split,
        isInGroup,
        add,
        divide,
        remove,
        select,
    };
}

export type TerminalSessions = ReturnType<typeof useTerminalSessions>;

/** Terminal tab: the shells on the left, a narrow list of the sessions on the right. */
export function ActivityTerminal({
    sessions,
    visible,
}: {
    sessions: TerminalSessions;
    /** The tab is on screen; the shells stay alive when it is not. */
    visible: boolean;
}) {
    const { terminals, active, split, isInGroup, remove, select, divide } =
        sessions;
    // * The list keeps its order: a connector line joins the two rows of the group.
    const groupRows = terminals
        .map((terminal, index) => (isInGroup(terminal.id) ? index : -1))
        .filter((index) => index !== -1);
    const groupStart = groupRows[0] ?? -1;
    const groupEnd = groupRows[1] ?? -1;

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
                            terminalId={terminal.id}
                            adoptedId={terminal.adoptedId}
                            root={terminal.root}
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
                {terminals.map((terminal, index) => {
                    const isActive = terminal.id === active;
                    const connector =
                        index === groupStart
                            ? '\u250c'
                            : index === groupEnd
                              ? '\u2514'
                              : index > groupStart && index < groupEnd
                                ? '\u2502'
                                : null;

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
                                    onClick={() => divide(terminal.id)}
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
