import {
    ChevronRight,
    FileText,
    FolderTree,
    Image as ImageIcon,
    ListChecks,
    Paperclip,
    Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { AiChatActivityStep } from '@/types';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const STEP: Record<string, { label: string; icon: LucideIcon }> = {
    tree: { label: 'work_steps.read_structure', icon: FolderTree },
    file: { label: 'work_steps.read_file', icon: FileText },
    attachment: { label: 'work_steps.read_attachment', icon: Paperclip },
    image: { label: 'work_steps.view_image', icon: ImageIcon },
    ask: { label: 'work_steps.ask_ai', icon: Sparkles },
};

// * Steps whose detail is a path or file name read best in monospace; the rest are plain sentences.
const PATH_KINDS = new Set(['tree', 'file', 'attachment', 'image']);

/** * "Đã làm N bước": what the app did for one answer, one row per step. Always folded until the person opens it; `live` only marks it as work in progress. */
export function WorkSteps({
    steps,
    live = false,
    className,
}: {
    steps: AiChatActivityStep[];
    live?: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(false);

    if (steps.length === 0) {
        return null;
    }

    return (
        <div className={cn('text-sm text-muted-foreground', className)}>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="-ml-1 flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            >
                <ListChecks
                    aria-hidden="true"
                    className={cn(
                        'size-4',
                        live && 'motion-safe:animate-pulse',
                    )}
                />
                {live
                    ? t('work_steps.working_count_steps', {
                          count: steps.length,
                      })
                    : t('work_steps.done_count_steps', { count: steps.length })}
                <ChevronRight
                    aria-hidden="true"
                    className={cn(
                        'size-4 transition-transform duration-150 motion-reduce:transition-none',
                        open && 'rotate-90',
                    )}
                />
            </button>
            {open && (
                <ul className="mt-1.5 ml-2 flex flex-col gap-1.5 border-l pl-4 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
                    {steps.map((step, index) => {
                        const meta = STEP[step.kind] ?? {
                            label: step.kind,
                            icon: FileText,
                        };
                        const Icon = meta.icon;

                        return (
                            <li
                                key={`${step.kind}-${step.detail}-${index}`}
                                className="flex min-w-0 items-center gap-2"
                            >
                                <Icon
                                    aria-hidden="true"
                                    className="size-4 shrink-0"
                                />
                                <span className="shrink-0">
                                    {t(meta.label)}
                                </span>
                                <span
                                    title={`${step.source}: ${step.detail}`}
                                    className={cn(
                                        'min-w-0 flex-1 truncate',
                                        PATH_KINDS.has(step.kind) &&
                                            'font-mono text-xs',
                                    )}
                                >
                                    {step.detail || step.source}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
