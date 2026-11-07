import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ResizeHandle } from '@/components/ai-chat/resize-handle';
import type { useResizableWidth } from '@/hooks/use-resizable-width';
import { cn } from '@/lib/utils';
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
    width,
    edge,
    isFilling,
}: {
    localRoot: string;
    localChanges: ReturnType<typeof useLocalChanges>;
    /** * The AI account and model picked in the chat: the commit box's "Tạo bằng AI" asks that one. */
    aiSelection?: { accountId: number | null; model: string | null };
    actions: FileActions;
    onOpenFile: (path: string) => void;
    /** * The column's own width, dragged by its edge; the chat takes the rest. */
    width: ReturnType<typeof useResizableWidth>;
    /** * The edge the handle is on: the left one, or the right one when the files sit on the left. */
    edge: 'leading' | 'trailing';
    /** * The chat is folded away: the column takes all the room instead of its own width. */
    isFilling: boolean;
}) {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <section
            aria-label={t('changes_panel.changes_against_git')}
            style={isFilling ? undefined : { width: width.width }}
            className={cn(
                '@container relative hidden min-h-0 max-w-full min-w-0 flex-col overflow-hidden lg:flex [&>*]:@max-[10rem]:hidden',
                isFilling ? 'flex-1' : 'shrink-0',
                edge === 'leading' && 'border-l',
            )}
        >
            {!isFilling && (
                <ResizeHandle
                    label={t('changes_panel.resize')}
                    className={
                        edge === 'trailing'
                            ? 'right-0 left-auto translate-x-0'
                            : 'translate-x-0'
                    }
                    {...width.handleProps}
                />
            )}
            <OutgoingCommits root={localRoot} refreshKey={localChanges.files} />
            <div
                className={
                    isOpen
                        ? 'flex min-h-0 flex-1 flex-col'
                        : 'flex shrink-0 flex-col'
                }
            >
                <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3 text-sm">
                    <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setIsOpen((current) => !current)}
                        className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                        {isOpen ? (
                            <ChevronDown
                                aria-hidden="true"
                                className="size-4"
                            />
                        ) : (
                            <ChevronRight
                                aria-hidden="true"
                                className="size-4"
                            />
                        )}
                        <span className="truncate">{t('common.changes')}</span>
                        {(localChanges.files ?? []).length > 0 && (
                            <span className="text-muted-foreground tabular-nums">
                                {t('changes_panel.count_files', {
                                    count: (localChanges.files ?? []).length,
                                })}
                            </span>
                        )}
                    </button>
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
                {isOpen && (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <LocalChanges
                            root={localRoot}
                            list={localChanges}
                            onOpenFile={onOpenFile}
                            actions={actions}
                        />
                    </div>
                )}
            </div>
        </section>
    );
}
