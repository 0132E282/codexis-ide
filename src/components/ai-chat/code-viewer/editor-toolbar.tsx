import { Check, Code2, Eye, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AssistantAvatar } from '@/components/ai-chat/assistant-avatar';
import type { AssistantIdentity } from '@/components/ai-chat/assistant-avatar';
import type { AiChatProposal } from '@/types';

/** * The bar above the open file: its path, the markdown view switch, the AI edit buttons (apply / drop / take back), ask the AI and close. */
export function EditorToolbar({
    selected,
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
    onClose,
}: {
    selected: string;
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
    onClose: (path: string) => void;
}) {
    return (
        <div className="flex h-12 items-center justify-between gap-2 border-b px-3 text-xs text-muted-foreground">
            <span className="truncate" dir="rtl">
                <bdi>
                    {selected.split('/').slice(0, -1).join(' / ')}
                    {selected.includes('/') && ' / '}
                    <span className="font-medium text-foreground">
                        {selected.split('/').pop()}
                    </span>
                </bdi>
            </span>
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
                                Xem
                            </TabsTrigger>
                            <TabsTrigger
                                value="code"
                                className="gap-1 px-2.5 text-xs"
                            >
                                <Code2 aria-hidden="true" />
                                Mã
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
                            aria-label="Áp dụng thay đổi của AI"
                            title="Áp dụng thay đổi của AI vào tệp (Cmd/Ctrl+S)"
                            disabled={deciding}
                            onClick={() => onDecide('apply')}
                            className="h-7 gap-1 px-2 text-xs text-green-600 dark:text-green-400"
                        >
                            <Check aria-hidden="true" />
                            Áp dụng
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Bỏ thay đổi của AI"
                            title="Bỏ thay đổi của AI"
                            disabled={deciding}
                            onClick={() => onDecide('reject')}
                            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                        >
                            <Undo2 aria-hidden="true" />
                            Bỏ
                        </Button>
                    </>
                )}
                {appliedEdit !== undefined && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Hoàn tác thay đổi của AI"
                        title="Hoàn tác thay đổi của AI"
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
                        aria-label="Hỏi AI về đoạn đang chọn hoặc cả tệp"
                        title="Hỏi AI về đoạn đang chọn (không chọn: cả tệp) · ⌘L"
                        onClick={() => onAskTrigger()}
                        className="size-7"
                    >
                        <AssistantAvatar
                            {...(assistant ?? {})}
                            className="size-5"
                        />
                    </Button>
                )}

                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Đóng tệp"
                    onClick={() => onClose(selected)}
                    className="size-7"
                >
                    <X aria-hidden="true" />
                </Button>
            </span>
        </div>
    );
}
