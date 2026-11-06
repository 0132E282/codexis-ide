import { t } from '@/lib/i18n';
import { Check, Code2, Eye, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import type { AiChatProposal } from '@/types';

/** * The buttons of the open file, shown at the end of the tab bar: the markdown view switch, the AI edit buttons (apply / drop / take back) and ask the AI. */
export function EditorToolbar({
    preview,
    onPreviewChange,
    showPreviewSwitch,
    pendingEdit,
    appliedEdit,
    deciding,
    onDecide,
    showAsk,
    assistant,
    onAskTrigger,
}: {
    /** * The markdown is shown rendered instead of as code. */
    preview: boolean;
    onPreviewChange: (preview: boolean) => void;
    /** * The rendered/code switch only shows for a loaded markdown file that is not a diff. */
    showPreviewSwitch: boolean;
    pendingEdit: AiChatProposal | undefined;
    appliedEdit: AiChatProposal | undefined;
    deciding: boolean;
    onDecide: (kind: 'apply' | 'reject' | 'revert') => void;
    /** * Whether the "ask the AI" button shows. */
    showAsk: boolean;
    assistant?: AssistantIdentity;
    onAskTrigger: () => void;
}) {
    return (
        <>
            <span className="flex shrink-0 items-center gap-1">
                {showPreviewSwitch && (
                    <Tabs
                        value={preview ? 'view' : 'code'}
                        onValueChange={(value) =>
                            onPreviewChange(value === 'view')
                        }
                    >
                        <TabsList className="h-7">
                            <TabsTrigger
                                value="view"
                                className="gap-1 px-2.5 text-xs"
                            >
                                <Eye aria-hidden="true" />
                                {t('common.view')}
                            </TabsTrigger>
                            <TabsTrigger
                                value="code"
                                className="gap-1 px-2.5 text-xs"
                            >
                                <Code2 aria-hidden="true" />
                                {t('editor_toolbar.code')}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
                {pendingEdit !== undefined && (
                    <>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('editor_toolbar.apply_ai_changes')}
                            title={t('editor_toolbar.apply_ai_changes_to')}
                            disabled={deciding}
                            onClick={() => onDecide('apply')}
                            className="h-7 gap-1 px-2 text-xs text-green-600 dark:text-green-400"
                        >
                            <Check aria-hidden="true" />
                            {t('common.apply')}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('editor_toolbar.discard_ai_changes')}
                            title={t('editor_toolbar.discard_ai_changes')}
                            disabled={deciding}
                            onClick={() => onDecide('reject')}
                            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                        >
                            <Undo2 aria-hidden="true" />
                            {t('editor_toolbar.discard')}
                        </Button>
                    </>
                )}
                {appliedEdit !== undefined && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('editor_toolbar.undo_ai_changes')}
                        title={t('editor_toolbar.undo_ai_changes')}
                        disabled={deciding}
                        onClick={() => onDecide('revert')}
                        className="size-7 text-muted-foreground"
                    >
                        <Undo2 aria-hidden="true" />
                    </Button>
                )}
                {showAsk && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('editor_toolbar.ask_ai_about_the2')}
                        title={t('editor_toolbar.ask_ai_about_the')}
                        onClick={() => onAskTrigger()}
                        className="size-7"
                    >
                        <AssistantAvatar
                            {...(assistant ?? {})}
                            className="size-5"
                        />
                    </Button>
                )}
            </span>
        </>
    );
}
