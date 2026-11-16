import { FileDiff, HardDrive, Play, Undo2 } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { UnifiedDiff } from '@/components/ai-chat/unified-diff';
import { Button } from '@/components/ui/button';
import { ChangesViewerContext } from '@/contexts/changes-viewer-context';
import { ProjectRootContext } from '@/contexts/project-root-context';
import { useConfirm } from '@/hooks/use-confirm';
import { api } from '@/lib/api';
import { invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import { t, translateError } from '@/lib/i18n';
import { ide, onTerminalData, onTerminalExit } from '@/lib/ide';
import type { ChangedFile, Step } from '@/lib/ide';
import { findRunnableCommands } from '@/lib/runnable-files';
import type { ProjectFileReader, RunnableCommand } from '@/lib/runnable-files';

// * A turn in worktree mode edits a copy kept in the app's data folder: the part up to the copy's own root is noise.
const WORKTREE_PREFIX = /^.*\/worktrees\/[^/]+\/[^/]+\//;

const STATUS_KEY = {
    M: 'changed_files.modified',
    A: 'changed_files.created',
    D: 'changed_files.deleted',
} as const;

/** The edit calls of the turn by the file they changed, to show a diff without asking git again. */
function changesByPath(steps: Step[]) {
    const changes = new Map<string, { before: string; after: string }>();

    for (const step of steps) {
        if (step.kind === 'tool' && step.change !== undefined) {
            changes.set(step.input, step.change);
        }
    }

    return changes;
}

/** Diff of a file whose edit the turn did not record (a shell command wrote it): read from git `HEAD` and from the disk. */
function GitFileDiff({ file }: { file: ChangedFile }) {
    const root = useContext(ProjectRootContext);
    const [sides, setSides] = useState<{
        before: string;
        after: string;
    } | null>(null);

    useEffect(() => {
        let cancelled = false;
        const head =
            file.status === 'A'
                ? Promise.resolve('')
                : api
                      .get<{ content?: string }>('/ai-chat/local/head', {
                          params: { path: file.path, root },
                      })
                      .then(({ data }) => data.content ?? '');
        const current =
            file.status === 'D'
                ? Promise.resolve('')
                : api
                      .get<{ content?: string }>('/ai-chat/local/file', {
                          params: { path: file.path, root },
                      })
                      .then(({ data }) => data.content ?? '');

        Promise.all([head, current])
            .then(([before, after]) => {
                if (!cancelled) {
                    setSides({ before, after });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSides({ before: '', after: '' });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [file.path, file.status, root]);

    return sides === null ? null : (
        <UnifiedDiff before={sides.before} after={sides.after} />
    );
}

// * Colors, cursor moves and title sequences of the shell: the output is shown as plain text.
const TERMINAL_ESCAPE =
    // eslint-disable-next-line no-control-regex
    /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|\r/g;

/** The files read to tell a project's migration tools, by project folder and path: each is read once for the life of the window. */
const projectFileCache = new Map<string, Promise<string | undefined>>();

/** A reader of the files of one project folder: the text of a file, '' when it is there but not text (binary, too large), undefined when it is missing. */
function projectFileReader(root: string | undefined): ProjectFileReader {
    return (path) => {
        const key = `${root ?? ''}\n${path}`;
        let read = projectFileCache.get(key);

        if (read === undefined) {
            const isPresentError = (caught: unknown) =>
                caught === translateError('workspace.too_large') ||
                caught === translateError('workspace.not_text');

            read = ide.read(path, root).then(
                ({ content }) => content,
                (caught: unknown) => (isPresentError(caught) ? '' : undefined),
            );
            projectFileCache.set(key, read);
        }

        return read;
    };
}

/** The commands the changed files ask for; none until the project's tools are known. */
function useRunnableCommands(
    files: ChangedFile[],
    root: string | undefined,
): RunnableCommand[] {
    const [commands, setCommands] = useState<RunnableCommand[]>([]);
    // * The effect follows the paths, not the array, which is a new one on every render of the thread.
    const filesKey = files
        .map((file) => `${file.status} ${file.path}`)
        .join('\n');

    useEffect(() => {
        let cancelled = false;

        findRunnableCommands(files, WORKTREE_PREFIX, projectFileReader(root))
            .then((found) => {
                if (!cancelled) {
                    setCommands(found);
                }
            })
            .catch((caught: unknown) => {
                console.error('Could not tell the runnable files', caught);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filesKey, root]);

    return commands;
}

/** One run of a command in a shell of its own, as the card shows it. */
type CommandRun = { command: string; output: string; isRunning: boolean };

/** The buttons that run what the changed files ask for (migrate, seed) in the project folder, and the output of the last run. */
function RunnableCommands({ commands }: { commands: RunnableCommand[] }) {
    const root = useContext(ProjectRootContext);
    const { confirm, dialog } = useConfirm();
    const [run, setRun] = useState<CommandRun | null>(null);
    const stopRun = useRef<(() => void) | null>(null);

    useEffect(() => () => stopRun.current?.(), []);

    // * Asks first, since a migration or a seed writes to the database; the shell starts in the project folder and leaves when the command ends.
    const runCommand = async (command: string) => {
        if (
            !(await confirm({
                title: t('changed_files.run_title'),
                description: t('changed_files.run_confirm', { command }),
                action: t('changed_files.run'),
            }))
        ) {
            return;
        }

        // * Shell ids are shared by every window: a random one never meets a shell of another card or window.
        const sessionId = `run-${crypto.randomUUID().slice(0, 8)}`;
        const append = (text: string) =>
            setRun((current) =>
                current === null
                    ? current
                    : { ...current, output: current.output + text },
            );

        setRun({ command, output: '', isRunning: true });

        // * Listens before the shell opens, so nothing it prints first is missed.
        const stops = await Promise.all([
            onTerminalData((event) => {
                if (event.id === sessionId) {
                    append(event.data.replace(TERMINAL_ESCAPE, ''));
                }
            }),
            onTerminalExit((id) => {
                if (id === sessionId) {
                    finish();
                }
            }),
        ]);
        const finish = () => {
            stops.forEach((stop) => stop());
            stopRun.current = null;
            setRun((current) =>
                current === null ? current : { ...current, isRunning: false },
            );
        };

        stopRun.current = () => {
            stops.forEach((stop) => stop());
            void ide.terminalClose(sessionId).catch(() => undefined);
        };

        try {
            await ide.terminalOpen(sessionId, 120, 30, root);
            await ide.terminalWrite(sessionId, `${command}; exit\r`);
        } catch (caught) {
            append(caught instanceof Error ? caught.message : String(caught));
            finish();
            void ide.terminalClose(sessionId).catch(() => undefined);
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
                {commands.map((runnable) => (
                    <Button
                        key={runnable.command}
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={run?.isRunning === true}
                        title={runnable.command}
                        onClick={() => void runCommand(runnable.command)}
                    >
                        <Play aria-hidden="true" />
                        {runnable.label}
                    </Button>
                ))}
            </div>
            {run !== null && (
                <div className="overflow-hidden rounded-md border bg-background">
                    <p
                        className="truncate border-b px-3 py-1.5 text-xs text-muted-foreground"
                        aria-live="polite"
                    >
                        {run.isRunning
                            ? t('changed_files.running', {
                                  command: run.command,
                              })
                            : t('changed_files.run_finished', {
                                  command: run.command,
                              })}
                    </p>
                    <pre className="max-h-60 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
                        {run.output}
                    </pre>
                </div>
            )}
            {dialog}
        </div>
    );
}

/** The card after a turn: the files the AI changed, each with what happened to it, and the actions to review or undo them. */
export function ChangedFilesCard({
    files,
    steps,
    projectName,
}: {
    files: ChangedFile[];
    steps: Step[];
    projectName: string;
}) {
    const [reviewingPaths, setReviewingPaths] = useState<string[]>([]);
    const [reverted, setReverted] = useState(false);
    const [busy, setBusy] = useState(false);
    const { confirm, dialog } = useConfirm();
    const changesViewer = useContext(ChangesViewerContext);
    const root = useContext(ProjectRootContext);
    const changes = changesByPath(steps);
    const runnableCommands = useRunnableCommands(files, root);

    const toggleReview = (filePath: string) =>
        setReviewingPaths((current) =>
            current.includes(filePath)
                ? current.filter((candidate) => candidate !== filePath)
                : [...current, filePath],
        );

    // * Puts every file back as git `HEAD` has it (a new file is removed); asks first, since the edits are lost.
    const undo = async () => {
        if (
            !(await confirm({
                title: t('local_changes.discard_changes'),
                description: t('changed_files.discard_all', {
                    count: files.length,
                }),
                action: t('local_changes.discard'),
            }))
        ) {
            return;
        }

        setBusy(true);

        try {
            for (const file of files) {
                await api.post('/ai-chat/local/discard', {
                    path: file.path,
                    root,
                });
            }
            invalidateAiChatCache('file.local:');
            setReverted(true);
            toast.success(t('changed_files.discarded'));
        } catch (caught) {
            toast.error(
                requestErrorMessage(
                    caught,
                    t('local_changes.could_not_discard_changes'),
                ),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-w-0 space-y-3 rounded-xl border bg-card p-3">
            <div className="flex items-center gap-2">
                <p className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
                    <HardDrive
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 truncate">
                        {t('changed_files.title', {
                            count: files.length,
                            project: projectName,
                        })}
                    </span>
                </p>
                {changesViewer !== null && (
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0"
                        aria-label={t('changed_files.open_changes')}
                        title={t('changed_files.open_changes')}
                        onClick={changesViewer.open}
                    >
                        <FileDiff aria-hidden="true" />
                    </Button>
                )}
                {!reverted && (
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0"
                        disabled={busy}
                        aria-label={t('local_changes.discard')}
                        title={t('local_changes.discard')}
                        onClick={() => void undo()}
                    >
                        <Undo2 aria-hidden="true" />
                    </Button>
                )}
            </div>
            <ul className="space-y-1.5">
                {files.map((file) => {
                    const path = file.path.replace(WORKTREE_PREFIX, '');
                    const change = changes.get(file.path);
                    const status =
                        STATUS_KEY[file.status as keyof typeof STATUS_KEY] ??
                        STATUS_KEY.M;

                    const isReviewing = reviewingPaths.includes(file.path);

                    return (
                        <li
                            key={file.path}
                            className="min-w-0 overflow-hidden rounded-md border bg-background"
                        >
                            <button
                                type="button"
                                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                                aria-expanded={isReviewing}
                                aria-label={`${t('changed_files.review')}: ${path}`}
                                onClick={() => toggleReview(file.path)}
                            >
                                <FileIcon
                                    name={path.split('/').pop() ?? path}
                                    className="size-4 shrink-0"
                                />
                                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                    {path}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {t(status)} ·{' '}
                                    {reverted
                                        ? t('changed_files.reverted')
                                        : t('changed_files.applied')}
                                </span>
                            </button>
                            {isReviewing && (
                                <div className="max-h-72 overflow-auto border-t">
                                    {change !== undefined ? (
                                        <UnifiedDiff
                                            before={change.before}
                                            after={change.after}
                                        />
                                    ) : (
                                        <GitFileDiff file={file} />
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            {!reverted && runnableCommands.length > 0 && (
                <RunnableCommands commands={runnableCommands} />
            )}
            {dialog}
        </div>
    );
}
