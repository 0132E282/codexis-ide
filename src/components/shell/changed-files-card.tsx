import { Eye, HardDrive, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { UnifiedDiff } from '@/components/ai-chat/unified-diff';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/use-confirm';
import { api } from '@/lib/api';
import { invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import { t } from '@/lib/i18n';
import type { ChangedFile, Step } from '@/lib/ide';

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
                          params: { path: file.path },
                      })
                      .then(({ data }) => data.content ?? '');
        const current =
            file.status === 'D'
                ? Promise.resolve('')
                : api
                      .get<{ content?: string }>('/ai-chat/local/file', {
                          params: { path: file.path },
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
    }, [file.path, file.status]);

    return sides === null ? null : (
        <UnifiedDiff before={sides.before} after={sides.after} />
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
    const [reviewing, setReviewing] = useState(false);
    const [reverted, setReverted] = useState(false);
    const [busy, setBusy] = useState(false);
    const { confirm, dialog } = useConfirm();
    const changes = changesByPath(steps);

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
                await api.post('/ai-chat/local/discard', { path: file.path });
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
            <p className="flex items-center gap-2 text-sm font-medium">
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
            <ul className="space-y-1.5">
                {files.map((file) => {
                    const path = file.path.replace(WORKTREE_PREFIX, '');
                    const change = changes.get(file.path);
                    const status =
                        STATUS_KEY[file.status as keyof typeof STATUS_KEY] ??
                        STATUS_KEY.M;

                    return (
                        <li
                            key={file.path}
                            className="min-w-0 overflow-hidden rounded-md border bg-background"
                        >
                            <div className="flex items-center gap-2 px-3 py-2">
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
                            </div>
                            {reviewing && (
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
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={reviewing}
                    onClick={() => setReviewing(!reviewing)}
                >
                    <Eye aria-hidden="true" />
                    {t('changed_files.review')}
                </Button>
                {!reverted && (
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void undo()}
                    >
                        <Undo2 aria-hidden="true" />
                        {t('local_changes.discard')}
                    </Button>
                )}
            </div>
            {dialog}
        </div>
    );
}
