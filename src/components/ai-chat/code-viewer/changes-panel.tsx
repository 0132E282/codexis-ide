import { OutgoingCommits } from '@/components/ai-chat/code-viewer/outgoing-commits';
import { t } from '@/lib/i18n';
import { CommitActions } from '@/components/ai-chat/commit-box';
import type { FileActions } from '@/components/ai-chat/file-context-menu';
import {
    LocalChanges,
    useLocalChanges,
} from '@/components/ai-chat/local-changes';

/** * The column that lists every file that differs from git HEAD, with the commit actions in its header. */
export function ChangesPanel({
    localRoot,
    localChanges,
    aiSelection,
    actions,
    onOpenFile,
}: {
    localRoot: string;
    localChanges: ReturnType<typeof useLocalChanges>;
    /** * The AI account and model picked in the chat: the commit box's "Tạo bằng AI" asks that one. */
    aiSelection?: { accountId: number | null; model: string | null };
    actions: FileActions;
    onOpenFile: (path: string) => void;
}) {
    return (
        <section
            aria-label={t('changes_panel.changes_against_git')}
            className="@container relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex [&>*]:@max-[10rem]:hidden"
        >
            <div className="flex h-12 items-center gap-2 border-b px-3 text-sm font-medium">
                {t('common.changes')}
                {(localChanges.files ?? []).length > 0 && (
                    <span className="text-muted-foreground tabular-nums">
                        {t('changes_panel.count_files', {
                            count: (localChanges.files ?? []).length,
                        })}
                    </span>
                )}
                <CommitActions
                    root={localRoot}
                    disabled={
                        !localChanges.git ||
                        (localChanges.files ?? []).length === 0
                    }
                    accountId={aiSelection?.accountId ?? null}
                    model={aiSelection?.model ?? null}
                    onCommitted={localChanges.refresh}
                />
            </div>
            <OutgoingCommits root={localRoot} refreshKey={localChanges.files} />
            <LocalChanges
                root={localRoot}
                list={localChanges}
                onOpenFile={onOpenFile}
                actions={actions}
            />
        </section>
    );
}
