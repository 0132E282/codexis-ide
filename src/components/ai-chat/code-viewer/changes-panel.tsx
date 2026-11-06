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
            aria-label="Thay đổi so với git"
            className="@container relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex [&>*]:@max-[10rem]:hidden"
        >
            <div className="flex h-12 items-center gap-2 border-b px-3 text-sm font-medium">
                Thay đổi
                {(localChanges.files ?? []).length > 0 && (
                    <span className="text-muted-foreground tabular-nums">
                        {(localChanges.files ?? []).length} tệp
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
            <LocalChanges
                root={localRoot}
                list={localChanges}
                onOpenFile={onOpenFile}
                actions={actions}
            />
        </section>
    );
}
