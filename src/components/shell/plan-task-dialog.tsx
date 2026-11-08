import { useState } from 'react';
import type { FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Field } from '@/components/form';
import { PlanEvidenceText } from '@/components/shell/plan-evidence-images';
import { STATUS_STYLE, STATUS_TEXT } from '@/components/shell/plan-status';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import type { PlanTask } from '@/lib/ide';
import { cn } from '@/lib/utils';

/** One task of a plan in a rectangular popup: its facts on top, and a box at the bottom to ask the AI about it (the question goes to the chat of the project together with the task). */
export function PlanTaskDialog({
    root,
    planPath,
    task,
    onClose,
    onOpenFile,
    onSendPrompt,
}: {
    root: string | undefined;
    /** Path of the plan file, relative to the project. */
    planPath: string;
    /** The task shown; null keeps the panel closed. */
    task: PlanTask | null;
    onClose: () => void;
    onOpenFile: (path: string) => void;
    /** Sends a message to the chat of the project. */
    onSendPrompt: (text: string) => void;
}) {
    const [message, setMessage] = useState('');
    const question = message.trim();
    const label =
        task === null
            ? ''
            : [task.id, task.title].filter((part) => part !== null).join(' ');

    const send = (event: FormEvent) => {
        event.preventDefault();

        if (task === null || question === '') {
            return;
        }

        onSendPrompt(
            t('plans.task_prompt', { path: planPath, task: label, question }),
        );
        setMessage('');
        onClose();
    };

    return (
        <Dialog
            open={task !== null}
            onOpenChange={(isOpen) => !isOpen && onClose()}
        >
            <DialogContent
                className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-5xl"
                data-testid="plan-task-dialog"
            >
                {task !== null && (
                    <>
                        <DialogHeader className="border-b p-4 pr-10">
                            <DialogTitle className="text-sm break-words">
                                {label}
                            </DialogTitle>
                            <DialogDescription asChild>
                                <div className="flex flex-wrap items-center gap-1">
                                    <span
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-[11px] font-medium',
                                            STATUS_STYLE[task.status],
                                        )}
                                    >
                                        {task.rawStatus ??
                                            t(STATUS_TEXT[task.status])}
                                    </span>
                                    {task.priority !== null && (
                                        <span className="rounded border px-1 text-[11px]">
                                            {task.priority}
                                        </span>
                                    )}
                                </div>
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
                            {task.files.length > 0 && (
                                <div>
                                    <div className="text-xs font-medium text-muted-foreground">
                                        {t('plans.files_to_change')}
                                    </div>
                                    <div className="mt-1 flex flex-col items-start gap-0.5">
                                        {task.files.map((file) => (
                                            <button
                                                key={file}
                                                type="button"
                                                title={file}
                                                onClick={() => onOpenFile(file)}
                                                className="font-mono text-xs break-all text-left underline-offset-2 hover:underline"
                                            >
                                                {file}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {task.result !== null && (
                                <div>
                                    <div className="text-xs font-medium text-muted-foreground">
                                        {t('plans.task_result')}
                                    </div>
                                    <div className="mt-1 text-xs break-words whitespace-pre-wrap">
                                        <PlanEvidenceText
                                            root={root}
                                            variant="slides"
                                            text={task.result}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <form
                            onSubmit={send}
                            className="flex shrink-0 items-center gap-2 border-t p-3"
                        >
                            <Field
                                name="plan-task-question"
                                className="min-w-0 flex-1"
                                value={message}
                                autoComplete="off"
                                placeholder={t('plans.task_chat_placeholder')}
                                aria-label={t('plans.task_chat_placeholder')}
                                onChange={(event) =>
                                    setMessage(event.target.value)
                                }
                            />
                            <Button
                                type="submit"
                                size="sm"
                                disabled={question === ''}
                            >
                                <Send aria-hidden="true" />
                                {t('plans.task_chat_send')}
                            </Button>
                        </form>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
