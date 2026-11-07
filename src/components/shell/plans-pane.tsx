import { FileJson, FileText, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Field } from '@/components/form';
import { PlanDetail } from '@/components/shell/plan-detail';
import {
    BAR_STYLE,
    STATUS_STYLE,
    STATUS_TEXT,
} from '@/components/shell/plan-status';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { ide } from '@/lib/ide';
import type { PlanDoc, PlanDocStatus, PlanDocsList } from '@/lib/ide';
import { cn } from '@/lib/utils';

type PlanFilter = 'all' | 'done' | 'in_progress' | 'draft';

const FILTER_KEY = 'ide.plans.filter';

const FILTERS: { id: PlanFilter; label: string }[] = [
    { id: 'all', label: 'plans.filter_all' },
    { id: 'done', label: 'plans.filter_done' },
    { id: 'in_progress', label: 'plans.filter_in_progress' },
    { id: 'draft', label: 'plans.filter_draft' },
];

// * Which statuses each quick filter shows.
const FILTER_STATUSES: Record<PlanFilter, PlanDocStatus[] | null> = {
    all: null,
    done: ['done'],
    in_progress: ['in_progress', 'partial'],
    draft: ['draft', 'todo'],
};

/** The filter the person chose last; the plans that are done come first by default. */
function readFilter(): PlanFilter {
    try {
        const stored = localStorage.getItem(FILTER_KEY);

        return FILTERS.some((filter) => filter.id === stored)
            ? (stored as PlanFilter)
            : 'done';
    } catch {
        return 'done';
    }
}

function saveFilter(filter: PlanFilter) {
    try {
        localStorage.setItem(FILTER_KEY, filter);
    } catch {
        // * The choice is only a convenience; without storage it lasts until the pane closes.
    }
}

/** What one load of the list is doing: running, done, or failed with the backend's message. */
type Load =
    | { state: 'loading' }
    | { state: 'done'; value: PlanDocsList }
    | { state: 'failed'; message: string };

function formatDate(plan: PlanDoc): string {
    return (
        plan.createdAt ??
        (plan.modifiedAt > 0
            ? new Date(plan.modifiedAt * 1000).toLocaleDateString()
            : '')
    );
}

function PlanCard({
    plan,
    onOpen,
}: {
    plan: PlanDoc;
    onOpen: (path: string) => void;
}) {
    const percent =
        plan.tasksTotal > 0
            ? Math.round((plan.tasksDone / plan.tasksTotal) * 100)
            : 0;
    const FormatIcon = plan.format === 'json' ? FileJson : FileText;

    return (
        <li>
            <button
                type="button"
                data-testid="plan-card"
                onClick={() => onOpen(plan.path)}
                className="flex h-full w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left text-sm text-card-foreground shadow-xs hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
                <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium break-words">
                        {plan.title}
                    </span>
                    <span
                        className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                            STATUS_STYLE[plan.status],
                        )}
                    >
                        {t(STATUS_TEXT[plan.status])}
                    </span>
                </span>
                {plan.description !== '' && (
                    <span className="line-clamp-3 text-xs text-muted-foreground">
                        {plan.description}
                    </span>
                )}
                {plan.tags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                        {plan.tags.map((tag) => (
                            <span
                                key={tag}
                                className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            >
                                {tag}
                            </span>
                        ))}
                    </span>
                )}
                <span className="mt-auto flex flex-col gap-1 pt-1">
                    <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                            {plan.tasksTotal > 0
                                ? t('plans.progress', {
                                      done: plan.tasksDone,
                                      total: plan.tasksTotal,
                                  })
                                : t('plans.no_tasks')}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span
                                title={
                                    plan.hasMarkdown
                                        ? t('plans.also_markdown')
                                        : undefined
                                }
                                className="flex items-center gap-1 rounded border px-1 py-px font-medium uppercase"
                            >
                                <FormatIcon
                                    aria-hidden="true"
                                    className="size-3"
                                />
                                {plan.format}
                                {plan.hasMarkdown && '+MD'}
                            </span>
                            {formatDate(plan)}
                        </span>
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
                </span>
            </button>
        </li>
    );
}

/** The plans of the project's `docs/plans/` folder as a grid of cards, filtered by status and searched by title or tag; a click opens the plan file in the editor. */
export function PlansPane({
    root,
    onOpenFile,
}: {
    /** Folder of the open project. */
    root: string | undefined;
    /** Opens a file of the project (path relative to it) in the editor. */
    onOpenFile: (path: string) => void;
}) {
    const [load, setLoad] = useState<Load>({ state: 'loading' });
    const [filter, setFilter] = useState<PlanFilter>(readFilter);
    const [search, setSearch] = useState('');
    // * The plan whose detail is shown instead of the list (its file path), or null.
    const [selected, setSelected] = useState<string | null>(null);

    // * Bumped by the refresh button to read the folder again.
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let isCurrent = true;

        ide.planDocsList(root)
            .then((value) => {
                if (isCurrent) {
                    setLoad({ state: 'done', value });
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
    }, [root, reload]);

    const refresh = () => {
        setLoad({ state: 'loading' });
        setReload((count) => count + 1);
    };

    const chooseFilter = (next: PlanFilter) => {
        setFilter(next);
        saveFilter(next);
    };

    const plans = useMemo(
        () => (load.state === 'done' ? load.value.plans : []),
        [load],
    );
    const visible = useMemo(() => {
        const statuses = FILTER_STATUSES[filter];
        const query = search.trim().toLowerCase();

        return plans.filter(
            (plan) =>
                (statuses === null || statuses.includes(plan.status)) &&
                (query === '' ||
                    plan.title.toLowerCase().includes(query) ||
                    plan.tags.some((tag) => tag.toLowerCase().includes(query))),
        );
    }, [plans, filter, search]);

    let body;

    if (load.state === 'loading' && plans.length === 0) {
        body = t('plans.loading');
    } else if (load.state === 'failed') {
        body = t('plans.error', { message: load.message });
    } else if (plans.length === 0) {
        body = (
            <span className="flex flex-col gap-1">
                {t('plans.empty')}
                {load.state === 'done' && load.value.root !== '' && (
                    <span className="text-[11px] break-all">
                        {t('plans.empty_in', { root: load.value.root })}
                    </span>
                )}
            </span>
        );
    } else if (visible.length === 0) {
        body = (
            <span className="flex flex-col items-center gap-2">
                {search.trim() !== ''
                    ? t('plans.no_match')
                    : t('plans.empty_filter')}
                {filter !== 'all' && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => chooseFilter('all')}
                    >
                        {t('plans.show_all')}
                    </Button>
                )}
            </span>
        );
    } else {
        body = null;
    }

    if (selected !== null) {
        return (
            <PlanDetail
                root={root}
                path={selected}
                onBack={() => setSelected(null)}
                onOpenFile={onOpenFile}
            />
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
                <div
                    role="group"
                    aria-label={t('plans.filter_label')}
                    className="flex items-center gap-1"
                >
                    {FILTERS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            aria-pressed={filter === item.id}
                            onClick={() => chooseFilter(item.id)}
                            className={cn(
                                'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                filter === item.id &&
                                    'bg-accent font-medium text-accent-foreground',
                            )}
                        >
                            {t(item.label)}
                        </button>
                    ))}
                </div>
                <Field
                    name="plans-search"
                    className="ml-auto w-56 min-w-0"
                    value={search}
                    placeholder={t('plans.search')}
                    aria-label={t('plans.search')}
                    autoComplete="off"
                    onChange={(event) => setSearch(event.target.value)}
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('plans.refresh')}
                    title={t('plans.refresh')}
                    disabled={load.state === 'loading'}
                    onClick={refresh}
                    className="text-muted-foreground"
                >
                    <RefreshCw
                        aria-hidden="true"
                        className={cn(
                            'size-4',
                            load.state === 'loading' && 'animate-spin',
                        )}
                    />
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {body !== null ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {body}
                    </p>
                ) : (
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
                        {visible.map((plan) => (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                onOpen={setSelected}
                            />
                        ))}
                    </ul>
                )}
                {load.state === 'done' &&
                    (load.value.skipped > 0 || load.value.truncated) && (
                        <p className="pt-3 text-center text-[11px] text-muted-foreground">
                            {load.value.truncated && t('plans.truncated')}{' '}
                            {load.value.skipped > 0 &&
                                t('plans.skipped', {
                                    count: load.value.skipped,
                                })}
                        </p>
                    )}
            </div>
        </div>
    );
}
