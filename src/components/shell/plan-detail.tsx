import { ArrowLeft, Check, FileText, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    BAR_STYLE,
    continuePrompt,
    STATUS_STYLE,
    STATUS_TEXT,
} from '@/components/shell/plan-status';
import {
    imagePaths,
    PlanEvidenceText,
} from '@/components/shell/plan-evidence-images';
import { PlanTaskDialog } from '@/components/shell/plan-task-dialog';
import { Button } from '@/components/ui/button';
import { t, translateError } from '@/lib/i18n';
import { errorText, ide, onPlansChanged } from '@/lib/ide';
import type {
    MarkdownBlock,
    PlanDocDetail,
    PlanItem,
    PlanTask,
} from '@/lib/ide';
import { cn } from '@/lib/utils';

type Load =
    | { state: 'loading' }
    | { state: 'done'; plan: PlanDocDetail }
    | { state: 'failed'; message: string };

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {title}
            </h3>
            {children}
        </section>
    );
}

function ItemList({
    items,
    root,
}: {
    items: PlanItem[];
    root: string | undefined;
}) {
    return (
        <ul className="flex flex-col gap-1.5 text-sm">
            {items.map((item, index) => (
                <li key={`${item.id ?? ''}-${index}`} className="flex gap-2">
                    {item.id !== null && (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {item.id}
                        </span>
                    )}
                    <span className="min-w-0 break-words">
                        {item.text}
                        {item.note !== null && (
                            <span className="block text-xs text-muted-foreground">
                                <PlanEvidenceText
                                    root={root}
                                    text={item.note}
                                />
                            </span>
                        )}
                    </span>
                </li>
            ))}
        </ul>
    );
}

/** A checklist line of a Markdown plan as a task, so it opens the same popup as a task of a JSON plan; a line that names pictures hands them over as its result. */
function checklistTask(block: { text: string; checked: boolean }): PlanTask {
    return {
        id: null,
        title: block.text,
        status: block.checked ? 'done' : 'todo',
        rawStatus: null,
        priority: null,
        files: [],
        result: imagePaths(block.text).length > 0 ? block.text : null,
    };
}

function Blocks({
    blocks,
    root,
    onOpenTask,
}: {
    blocks: MarkdownBlock[];
    root: string | undefined;
    onOpenTask: (task: PlanTask) => void;
}) {
    return (
        <div className="flex flex-col gap-2 text-sm">
            {blocks.map((block, index) => {
                switch (block.kind) {
                    case 'heading':
                        return (
                            <h4
                                key={index}
                                className={cn(
                                    'mt-2 font-semibold',
                                    block.level <= 2 ? 'text-base' : 'text-sm',
                                )}
                            >
                                {block.text}
                            </h4>
                        );
                    case 'paragraph':
                        return (
                            <p key={index}>
                                <PlanEvidenceText
                                    root={root}
                                    text={block.text}
                                />
                            </p>
                        );
                    case 'bullet':
                        return (
                            <p key={index} className="flex gap-2">
                                <span aria-hidden="true">•</span>
                                <span className="min-w-0">
                                    <PlanEvidenceText
                                        root={root}
                                        text={block.text}
                                    />
                                </span>
                            </p>
                        );
                    case 'checklist':
                        return (
                            <button
                                key={index}
                                type="button"
                                onClick={() => onOpenTask(checklistTask(block))}
                                className="flex cursor-pointer gap-2 rounded text-left hover:bg-accent/40"
                            >
                                <input
                                    type="checkbox"
                                    checked={block.checked}
                                    readOnly
                                    tabIndex={-1}
                                    aria-label={block.text}
                                    className="mt-1"
                                />
                                <span className="min-w-0">{block.text}</span>
                            </button>
                        );
                    case 'code':
                        return (
                            <pre
                                key={index}
                                className="overflow-x-auto rounded bg-muted p-2 text-xs"
                            >
                                {block.text}
                            </pre>
                        );
                }
            })}
        </div>
    );
}

/** One plan in full: its card facts, then requirements, tasks, acceptance criteria and open questions (JSON) or the rendered body (Markdown). */
export function PlanDetail({
    root,
    path,
    onBack,
    onOpenFile,
    onSendPrompt,
}: {
    root: string | undefined;
    /** Path of the plan file, relative to the project. */
    path: string;
    onBack: () => void;
    onOpenFile: (path: string) => void;
    /** Sends a message to the chat of the project. */
    onSendPrompt: (text: string) => void;
}) {
    const [load, setLoad] = useState<Load>({ state: 'loading' });
    // * Bumped when a plan file changed, to read the plan again without a loading state.
    const [reload, setReload] = useState(0);
    // * The task whose slide-in panel is open.
    const [openTask, setOpenTask] = useState<PlanTask | null>(null);

    useEffect(() => {
        let isActive = true;
        let stop: (() => void) | undefined;

        void onPlansChanged(() => setReload((count) => count + 1)).then(
            (unlisten) => {
                if (isActive) {
                    stop = unlisten;
                } else {
                    unlisten();
                }
            },
        );

        return () => {
            isActive = false;
            stop?.();
        };
    }, []);

    useEffect(() => {
        let isCurrent = true;

        ide.planDocRead(path, root)
            .then((plan) => {
                if (isCurrent) {
                    setLoad({ state: 'done', plan });
                }
            })
            .catch((error: unknown) => {
                if (isCurrent) {
                    setLoad({
                        state: 'failed',
                        message:
                            typeof error === 'string'
                                ? error
                                : t('common.something_went_wrong'),
                    });
                }
            });

        return () => {
            isCurrent = false;
        };
    }, [root, path, reload]);

    const plan = load.state === 'done' ? load.plan : null;
    // * The tasks that are not done (any status but done): what "Làm task / Tiếp tục" hands to the AI.
    const prompt = plan === null ? null : continuePrompt(path, plan.tasks);
    const continuePlan = () => prompt !== null && onSendPrompt(prompt);
    // * The folder watcher reports the change; the reload covers a watcher that is not running.
    const markDone = () =>
        void ide
            .planDocSetStatus(path, 'done', root)
            .then(() => setReload((count) => count + 1))
            .catch((error: unknown) =>
                toast.error(translateError(errorText(error))),
            );
    const percent =
        plan !== null && plan.tasksTotal > 0
            ? Math.round((plan.tasksDone / plan.tasksTotal) * 100)
            : 0;
    const hasSections =
        plan !== null &&
        (plan.requirements.length > 0 ||
            plan.tasks.length > 0 ||
            plan.acceptanceCriteria.length > 0 ||
            plan.openQuestions.length > 0 ||
            plan.blocks.length > 0);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="plan-detail">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    className="text-muted-foreground"
                >
                    <ArrowLeft aria-hidden="true" />
                    {t('plans.back')}
                </Button>
                <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={prompt === null}
                    onClick={continuePlan}
                    className="ml-auto"
                >
                    <Play aria-hidden="true" />
                    {t(
                        plan !== null && plan.tasksDone > 0
                            ? 'plans.continue'
                            : 'plans.do_tasks',
                    )}
                </Button>
                {plan !== null && plan.status !== 'done' && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={markDone}
                    >
                        <Check aria-hidden="true" />
                        {t('plans.mark_done')}
                    </Button>
                )}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenFile(path)}
                >
                    <FileText aria-hidden="true" />
                    {t('plans.open_file')}
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {load.state === 'loading' && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {t('plans.detail_loading')}
                    </p>
                )}
                {load.state === 'failed' && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {t('plans.error', { message: load.message })}
                    </p>
                )}
                {plan !== null && (
                    <div className="mx-auto flex max-w-3xl flex-col gap-5">
                        <header className="flex flex-col gap-2">
                            <div className="flex items-start justify-between gap-2">
                                <h2 className="text-base font-semibold break-words">
                                    {plan.title}
                                </h2>
                                <span
                                    className={cn(
                                        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                                        STATUS_STYLE[plan.status],
                                    )}
                                >
                                    {t(STATUS_TEXT[plan.status])}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className="rounded border px-1 py-px font-medium uppercase">
                                    {plan.format}
                                </span>
                                {plan.createdAt !== null && (
                                    <span>{plan.createdAt}</span>
                                )}
                                {plan.tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="rounded bg-muted px-1.5 py-0.5"
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </div>
                            {plan.description !== '' && (
                                <p className="text-sm text-muted-foreground">
                                    {plan.description}
                                </p>
                            )}
                            {plan.tasksTotal > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-[11px] text-muted-foreground">
                                        {t('plans.progress', {
                                            done: plan.tasksDone,
                                            total: plan.tasksTotal,
                                        })}
                                    </span>
                                    <span
                                        role="progressbar"
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={percent}
                                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                                    >
                                        <span
                                            className={cn(
                                                'block h-full rounded-full',
                                                BAR_STYLE[plan.status],
                                            )}
                                            style={{ width: `${percent}%` }}
                                        />
                                    </span>
                                </div>
                            )}
                        </header>
                        {plan.requirements.length > 0 && (
                            <Section title={t('plans.section_requirements')}>
                                <ItemList
                                    items={plan.requirements}
                                    root={root}
                                />
                            </Section>
                        )}
                        {plan.tasks.length > 0 && (
                            <Section title={t('plans.section_tasks')}>
                                <ul className="flex flex-col gap-2">
                                    {plan.tasks.map((task, index) => (
                                        <li
                                            key={`${task.id ?? ''}-${index}`}
                                            // * The whole card opens the panel; a click on a button, a picture or the dialog drawn from inside it is that control's own.
                                            onClick={(event) => {
                                                const target =
                                                    event.target as HTMLElement;

                                                if (
                                                    event.currentTarget.contains(
                                                        target,
                                                    ) &&
                                                    !target.closest(
                                                        'button, a, img, [role="dialog"]',
                                                    )
                                                ) {
                                                    setOpenTask(task);
                                                }
                                            }}
                                            className="cursor-pointer rounded-md border p-2 text-sm hover:bg-accent/40"
                                        >
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setOpenTask(task)
                                                }
                                                className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
                                            >
                                                <span className="min-w-0 break-words">
                                                    {task.id !== null && (
                                                        <span className="mr-2 font-mono text-xs text-muted-foreground">
                                                            {task.id}
                                                        </span>
                                                    )}
                                                    {task.title}
                                                </span>
                                                <span className="flex shrink-0 items-center gap-1">
                                                    {task.priority !== null && (
                                                        <span className="rounded border px-1 text-[11px] text-muted-foreground">
                                                            {task.priority}
                                                        </span>
                                                    )}
                                                    <span
                                                        className={cn(
                                                            'rounded px-1.5 py-0.5 text-[11px] font-medium',
                                                            STATUS_STYLE[
                                                                task.status
                                                            ],
                                                        )}
                                                    >
                                                        {task.rawStatus ??
                                                            t(
                                                                STATUS_TEXT[
                                                                    task.status
                                                                ],
                                                            )}
                                                    </span>
                                                </span>
                                            </button>
                                            {task.files.length > 0 && (
                                                <div className="mt-1 text-xs text-muted-foreground">
                                                    {t('plans.files_to_change')}
                                                    :{' '}
                                                    <span className="inline-flex flex-wrap gap-x-2">
                                                        {task.files.map(
                                                            (file) => (
                                                                <button
                                                                    key={file}
                                                                    type="button"
                                                                    title={file}
                                                                    onClick={() =>
                                                                        onOpenFile(
                                                                            file,
                                                                        )
                                                                    }
                                                                    className="font-mono break-all text-left underline-offset-2 hover:text-foreground hover:underline"
                                                                >
                                                                    {file}
                                                                </button>
                                                            ),
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                            {task.result !== null && (
                                                <div className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
                                                    {t('plans.task_result')}:{' '}
                                                    <PlanEvidenceText
                                                        root={root}
                                                        text={task.result}
                                                    />
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </Section>
                        )}
                        {plan.acceptanceCriteria.length > 0 && (
                            <Section title={t('plans.section_criteria')}>
                                <ItemList
                                    items={plan.acceptanceCriteria}
                                    root={root}
                                />
                            </Section>
                        )}
                        {plan.openQuestions.length > 0 && (
                            <Section title={t('plans.section_questions')}>
                                <ItemList
                                    root={root}
                                    items={plan.openQuestions.map((item) => ({
                                        ...item,
                                        note:
                                            item.note === null
                                                ? null
                                                : t('plans.note_default', {
                                                      value: item.note,
                                                  }),
                                    }))}
                                />
                            </Section>
                        )}
                        {plan.blocks.length > 0 && (
                            <Blocks
                                blocks={plan.blocks}
                                root={root}
                                onOpenTask={setOpenTask}
                            />
                        )}
                        {!hasSections && (
                            <p className="text-sm text-muted-foreground">
                                {t('plans.detail_empty')}
                            </p>
                        )}
                    </div>
                )}
            </div>
            <PlanTaskDialog
                root={root}
                planPath={path}
                task={openTask}
                onClose={() => setOpenTask(null)}
                onOpenFile={onOpenFile}
                onSendPrompt={onSendPrompt}
            />
        </div>
    );
}
