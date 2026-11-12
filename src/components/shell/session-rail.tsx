import {
    GitBranch,
    GitPullRequest,
    History,
    MessageSquarePlus,
    Plug,
    Settings,
    TriangleAlert,
    X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { LocalBranchPopover } from '@/components/ai-chat/branch-popover';
import { FileIcon } from '@/components/ai-chat/file-icon';
import { StorageUsageBlock } from '@/components/shell/storage-usage-block';
import { formatTokens } from '@/components/shell/context-panel';
import type { ContextUsage } from '@/components/shell/context-panel';
import { Button } from '@/components/ui/button';
import { useSessionRail } from '@/hooks/use-session-rail';
import type { RailGithub } from '@/lib/ide-session-rail';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

function Block({
    title,
    action,
    children,
}: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section
            aria-label={title}
            className="flex flex-col gap-2 border-b px-3 py-3 last:border-b-0"
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                    {title}
                </h3>
                {action}
            </div>
            {children}
        </section>
    );
}

function Muted({ children }: { children: ReactNode }) {
    return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Row({
    icon,
    label,
    value,
    title,
}: {
    icon?: ReactNode;
    label: string;
    value: ReactNode;
    title?: string;
}) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                {icon}
                {label}
            </span>
            <span
                title={title}
                className="min-w-0 truncate text-right font-medium"
            >
                {value}
            </span>
        </div>
    );
}

type Segment = { key: string; label: string; tokens: number; color: string };

/** The parts of `used` the CLI reports: `used` minus the cache is what was sent fresh (Claude counts it as input, Codex already has the cache inside input). No finer split exists: Messages, tools, skills and the system prompt are not reported. */
function segmentsOf(usage: ContextUsage): Segment[] {
    const fresh = Math.max(
        0,
        usage.used - usage.cacheRead - usage.cacheCreation,
    );

    return [
        {
            key: 'fresh',
            label: t('session_rail.fresh_input'),
            tokens: fresh,
            color: 'bg-primary',
        },
        {
            key: 'read',
            label: t('session_rail.cache_read'),
            tokens: usage.cacheRead,
            color: 'bg-primary/55',
        },
        {
            key: 'creation',
            label: t('session_rail.cache_creation'),
            tokens: usage.cacheCreation,
            color: 'bg-primary/30',
        },
    ];
}

/** From this share of the window the context is reported as large: answers get slower and cost more. */
const CONTEXT_WARNING_PERCENT = 60;

function ContextBlock({
    usage,
    onClear,
}: {
    usage: ContextUsage | null;
    /** Opens a new chat, which starts without the history of this one. */
    onClear: () => void;
}) {
    if (usage === null) {
        return <Muted>{t('session_rail.context_empty')}</Muted>;
    }

    const segments = segmentsOf(usage);
    // * The bar is scaled to the window when it is known, otherwise to what was used.
    const total = usage.window ?? Math.max(usage.used, 1);
    const summary =
        usage.window === null
            ? t('session_rail.used_only', { used: formatTokens(usage.used) })
            : t('session_rail.used_of', {
                  used: formatTokens(usage.used),
                  window: formatTokens(usage.window),
              });

    return (
        <div className="flex flex-col gap-2">
            {usage.percent !== null && (
                <p className="text-sm font-medium tabular-nums">
                    {t('session_rail.percent_used', {
                        percent: Math.round(usage.percent),
                    })}
                </p>
            )}
            <div
                role="progressbar"
                aria-label={t('session_rail.context_bar')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usage.percent ?? 0)}
                className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
            >
                {segments.map((segment) => (
                    <div
                        key={segment.key}
                        title={`${segment.label}: ${formatTokens(segment.tokens)}`}
                        className={cn('h-full', segment.color)}
                        style={{
                            width: `${Math.min(100, (segment.tokens / total) * 100)}%`,
                        }}
                    />
                ))}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
                {summary}
            </p>
            {usage.percent !== null &&
                usage.percent >= CONTEXT_WARNING_PERCENT && (
                    <p
                        role="alert"
                        className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300"
                    >
                        <TriangleAlert
                            aria-hidden="true"
                            className="mt-0.5 size-3.5 shrink-0"
                        />
                        {t('session_rail.context_warning', {
                            percent: Math.round(usage.percent),
                        })}
                    </p>
                )}
            <ul className="flex flex-col gap-1">
                {segments.map((segment) => (
                    <li
                        key={segment.key}
                        className="flex items-center justify-between gap-3 text-xs"
                    >
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'size-2 rounded-full',
                                    segment.color,
                                )}
                            />
                            {segment.label}
                        </span>
                        <span className="font-medium tabular-nums">
                            {formatTokens(segment.tokens)}
                        </span>
                    </li>
                ))}
                <li className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">
                        {t('session_rail.output')}
                    </span>
                    <span className="font-medium tabular-nums">
                        {formatTokens(usage.output)}
                    </span>
                </li>
            </ul>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={onClear}
            >
                <MessageSquarePlus aria-hidden="true" />
                {t('session_rail.clear_context')}
            </Button>
        </div>
    );
}

function GithubBlock({ github, root }: { github: RailGithub; root: string }) {
    const message = {
        ok: null,
        no_cli: t('session_rail.github_no_cli'),
        signed_out: t('session_rail.github_signed_out'),
        no_remote: t('session_rail.github_no_remote'),
    }[github.status];

    return (
        <div className="flex flex-col gap-1.5">
            {github.account !== null && (
                <Row
                    label={t('session_rail.github_account')}
                    value={github.account}
                />
            )}
            {github.repo !== null && (
                <Row
                    label={t('session_rail.github_repo')}
                    value={`${github.repo.owner}/${github.repo.name}`}
                    title={github.repo.url}
                />
            )}
            <Row
                icon={<GitBranch aria-hidden="true" className="size-3.5" />}
                label={t('session_rail.branch')}
                value={<LocalBranchPopover root={root} inRow />}
            />
            {github.status === 'ok' &&
                (github.pullRequest === null ? (
                    <Muted>{t('session_rail.github_no_pull_request')}</Muted>
                ) : (
                    <Row
                        icon={
                            <GitPullRequest
                                aria-hidden="true"
                                className="size-3.5"
                            />
                        }
                        label={t('session_rail.github_pull_request')}
                        value={`#${github.pullRequest.number} ${github.pullRequest.title}`}
                        title={github.pullRequest.url}
                    />
                ))}
            {message !== null && <Muted>{message}</Muted>}
        </div>
    );
}

/**
 * The session rail of a project (docs/system/session-rail.md): Environment, Context, Connectors, Outputs and GitHub, all read-only except the settings button.
 * It only shows what the backend measured; the frame (edge, size) comes from DockLayout.
 */
export function SessionRail({
    root,
    projectName,
    conversation,
    context,
    refreshKey,
    placementMenu,
    onOpenSettings,
    onOpenFile,
    onShowHistory,
    onClearContext,
    onClose,
}: {
    root: string;
    projectName: string;
    conversation: number | null;
    /** Usage of the last turn of the open chat; null until a turn reports it. */
    context: ContextUsage | null;
    /** Changes when a turn finished, so files, branch and pull request are read again. */
    refreshKey: number;
    placementMenu: ReactNode;
    onOpenSettings: () => void;
    onOpenFile: (path: string) => void;
    /** Opens the git history tab of the bottom panel. */
    onShowHistory: () => void;
    /** Starts a new chat so the next turn does not carry the context of the open one. */
    onClearContext: () => void;
    onClose: () => void;
}) {
    const { environment, connectors, outputs, usage, github } = useSessionRail({
        root,
        conversation,
        enabled: true,
        refreshKey,
    });
    return (
        <section
            aria-label={t('session_rail.title')}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
        >
            <header
                data-rail-drag
                className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"
            >
                <h2 className="truncate text-sm font-medium">
                    {t('session_rail.title')}
                </h2>
                <div className="flex items-center">
                    {placementMenu}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('session_rail.close')}
                        title={t('session_rail.close')}
                        onClick={onClose}
                        className="text-muted-foreground"
                    >
                        <X aria-hidden="true" className="size-4" />
                    </Button>
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3">
                <Block
                    title={t('session_rail.environment')}
                    action={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('session_rail.settings')}
                            title={t('session_rail.settings')}
                            onClick={onOpenSettings}
                            className="size-6 text-muted-foreground"
                        >
                            <Settings aria-hidden="true" className="size-3.5" />
                        </Button>
                    }
                >
                    <p className="truncate text-sm font-medium">
                        {projectName}
                    </p>
                    {environment.failed && environment.data === null ? (
                        <Muted>{t('session_rail.load_failed')}</Muted>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <Row
                                label={t('session_rail.folder')}
                                value={environment.data?.folder ?? ''}
                                title={environment.data?.folder}
                            />
                            <Row
                                icon={
                                    <GitBranch
                                        aria-hidden="true"
                                        className="size-3.5"
                                    />
                                }
                                label={t('session_rail.branch')}
                                value={
                                    environment.data === null
                                        ? ''
                                        : (environment.data.branch ??
                                          t('session_rail.no_branch'))
                                }
                            />
                        </div>
                    )}
                </Block>
                <Block title={t('session_rail.context')}>
                    <ContextBlock usage={context} onClear={onClearContext} />
                </Block>
                <Block title={t('session_rail.connectors')}>
                    {connectors.failed && connectors.data === null ? (
                        <Muted>{t('session_rail.load_failed')}</Muted>
                    ) : connectors.data !== null &&
                      connectors.data.length === 0 ? (
                        <Muted>{t('session_rail.connectors_empty')}</Muted>
                    ) : (
                        <>
                            <ul className="flex flex-col gap-1.5">
                                {(connectors.data ?? []).map((server) => (
                                    <li
                                        key={`${server.scope}-${server.name}`}
                                        title={server.target}
                                        className="flex items-center justify-between gap-2 text-xs"
                                    >
                                        <span className="flex min-w-0 items-center gap-1.5">
                                            <Plug
                                                aria-hidden="true"
                                                className="size-3.5 shrink-0 text-muted-foreground"
                                            />
                                            <span className="truncate font-medium">
                                                {server.name}
                                            </span>
                                        </span>
                                        <span className="shrink-0 text-muted-foreground">
                                            {server.kind} ·{' '}
                                            {t('session_rail.configured')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <Muted>{t('session_rail.connectors_note')}</Muted>
                        </>
                    )}
                </Block>
                <Block title={t('session_rail.outputs')}>
                    {outputs.failed && outputs.data === null ? (
                        <Muted>{t('session_rail.load_failed')}</Muted>
                    ) : (outputs.data ?? []).length === 0 ? (
                        <Muted>{t('session_rail.outputs_empty')}</Muted>
                    ) : (
                        <ul className="flex flex-col">
                            {(outputs.data ?? []).map((file) => (
                                <li key={file.path}>
                                    <button
                                        type="button"
                                        title={file.path}
                                        onClick={() => onOpenFile(file.path)}
                                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
                                    >
                                        <FileIcon
                                            name={file.path}
                                            className="size-4 shrink-0"
                                        />
                                        <span className="truncate">
                                            {file.path}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Block>
                <Block title={t('session_rail.usage')}>
                    {usage.data === null ? (
                        <Muted>
                            {t(
                                usage.failed
                                    ? 'session_rail.load_failed'
                                    : 'session_rail.usage_empty',
                            )}
                        </Muted>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {usage.data.conversation === null ||
                            usage.data.conversation.turns === 0 ? (
                                <Muted>{t('session_rail.usage_empty')}</Muted>
                            ) : (
                                <>
                                    <Row
                                        label={t('session_rail.usage_turns')}
                                        value={t(
                                            'session_rail.usage_turns_value',
                                            {
                                                turns: usage.data.conversation
                                                    .turns,
                                                failed: usage.data.conversation
                                                    .failedTurns,
                                            },
                                        )}
                                    />
                                    <Row
                                        label={t('session_rail.usage_model')}
                                        value={
                                            context?.model ??
                                            t(
                                                'session_rail.usage_model_default',
                                                {
                                                    cli:
                                                        usage.data.conversation
                                                            .cli ?? '',
                                                },
                                            )
                                        }
                                    />
                                    <Row
                                        label={t('session_rail.usage_sent')}
                                        value={`~${formatTokens(usage.data.conversation.promptTokens)}`}
                                    />
                                    <Row
                                        label={t('session_rail.usage_received')}
                                        value={`~${formatTokens(usage.data.conversation.answerTokens)}`}
                                    />
                                </>
                            )}
                            <Muted>{t('session_rail.usage_note')}</Muted>
                        </div>
                    )}
                </Block>
                <Block title={t('storage.title')}>
                    <StorageUsageBlock root={root} refreshKey={refreshKey} />
                </Block>
                {(github.data?.status !== 'no_cli' ||
                    environment.data?.branch != null) && (
                    <Block
                        title={t('session_rail.github')}
                        // * Needs only a git repository, not a GitHub remote.
                        action={
                            environment.data?.branch != null && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    title={t('session_rail.git_history')}
                                    aria-label={t('session_rail.git_history')}
                                    className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                                    onClick={onShowHistory}
                                >
                                    <History aria-hidden="true" />
                                    {t('session_rail.git_history')}
                                </Button>
                            )
                        }
                    >
                        {github.data?.status ===
                        'no_cli' ? null : github.data === null ? (
                            github.failed && (
                                <Muted>{t('session_rail.load_failed')}</Muted>
                            )
                        ) : (
                            <GithubBlock github={github.data} root={root} />
                        )}
                    </Block>
                )}
            </div>
        </section>
    );
}
