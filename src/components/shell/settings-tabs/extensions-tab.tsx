import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/hooks/use-confirm';
import { t } from '@/lib/i18n';
import { ideLanguageServer } from '@/lib/ide-language-server';
import type {
    ExtensionRoot,
    LanguageServerInfo,
    ServerCandidate,
    ServerSourceSetting,
    ServerState,
} from '@/lib/ide-language-server';
import { cn } from '@/lib/utils';

const SELECT_CLASS =
    'h-8 rounded-sm border border-input bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring';

// * The download source (`download`) is not offered: the app never downloads a server in this version.
const SOURCES: ServerSourceSetting[] = ['auto', 'vscode', 'path'];
const EXTENSION_ROOTS: ExtensionRoot[] = [
    'vscode',
    'insiders',
    'cursor',
    'vscodium',
];

const STATE_VARIANT: Record<
    ServerState,
    'default' | 'secondary' | 'destructive' | 'outline'
> = {
    missing: 'outline',
    stopped: 'secondary',
    starting: 'secondary',
    running: 'default',
    error: 'destructive',
};

/** A fixed backend key (`language_server.*`) in the language of the interface; anything else is shown as it is. */
const reason = (key: string) => {
    const text = t(`errors.${key}`);

    return text === `errors.${key}` ? key : text;
};

const originLabel = (origin: ServerCandidate['origin']) =>
    t(`extensions_tab.origin_${origin}`);

/** The candidate the server uses now (or at its next start); null when none is usable. */
const selectedCandidate = (info: LanguageServerInfo) =>
    info.selected === null ? null : (info.candidates[info.selected] ?? null);

function InstallHintText({ info }: { info: LanguageServerInfo }) {
    if (info.installHint === null) {
        return null;
    }

    return (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {t(info.installHint.messageKey, {
                name: info.installHint.displayName,
                extension: info.installHint.extensionId ?? '',
            })}
        </p>
    );
}

function ServerDetail({
    info,
    busy,
    onConfigure,
    onRestart,
    onStop,
}: {
    info: LanguageServerInfo;
    busy: boolean;
    onConfigure: (
        source: ServerSourceSetting,
        extensionRoot: ExtensionRoot | null,
    ) => void;
    onRestart: () => void;
    onStop: () => void;
}) {
    const [log, setLog] = useState<string[] | null>(null);
    const [logError, setLogError] = useState<string | null>(null);
    const idPrefix = `extensions-${info.id}`;

    const showLog = async () => {
        setLogError(null);

        try {
            setLog(await ideLanguageServer.log(null, info.id));
        } catch (failure) {
            setLogError(String(failure));
        }
    };

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-end gap-3">
                <Field>
                    <FieldLabel htmlFor={`${idPrefix}-source`}>
                        {t('extensions_tab.source_setting')}
                    </FieldLabel>
                    <select
                        id={`${idPrefix}-source`}
                        value={info.source}
                        disabled={busy}
                        onChange={(event) =>
                            onConfigure(
                                event.target.value as ServerSourceSetting,
                                info.extensionRoot,
                            )
                        }
                        className={SELECT_CLASS}
                    >
                        {SOURCES.map((source) => (
                            <option key={source} value={source}>
                                {t(`extensions_tab.source_${source}`)}
                            </option>
                        ))}
                    </select>
                </Field>
                {info.source === 'vscode' && (
                    <Field>
                        <FieldLabel htmlFor={`${idPrefix}-root`}>
                            {t('extensions_tab.extension_root')}
                        </FieldLabel>
                        <select
                            id={`${idPrefix}-root`}
                            value={info.extensionRoot ?? ''}
                            disabled={busy}
                            onChange={(event) =>
                                onConfigure(
                                    info.source,
                                    event.target.value === ''
                                        ? null
                                        : (event.target.value as ExtensionRoot),
                                )
                            }
                            className={SELECT_CLASS}
                        >
                            <option value="">
                                {t('extensions_tab.root_any')}
                            </option>
                            {EXTENSION_ROOTS.map((root) => (
                                <option key={root} value={root}>
                                    {originLabel(root)}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}
                <span className="ml-auto flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || !info.enabled}
                        onClick={onRestart}
                    >
                        {t('extensions_tab.restart')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                            busy ||
                            (info.state !== 'running' &&
                                info.state !== 'starting')
                        }
                        onClick={onStop}
                    >
                        {t('extensions_tab.stop')}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void showLog()}
                    >
                        {t('extensions_tab.show_log')}
                    </Button>
                </span>
            </div>
            {info.lastError !== null && (
                <p role="alert" className="text-xs text-destructive">
                    {reason(info.lastError)}
                </p>
            )}
            <InstallHintText info={info} />
            <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('extensions_tab.found')}
                </h4>
                {info.candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        {t('extensions_tab.none_found')}
                    </p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {info.candidates.map((candidate, index) => (
                            <li
                                key={`${candidate.origin}:${candidate.path}`}
                                className={cn(
                                    'flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-xs',
                                    index === info.selected && 'bg-accent/40',
                                )}
                            >
                                <span className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">
                                        {candidate.label}
                                    </span>
                                    {candidate.version !== null && (
                                        <span className="text-muted-foreground">
                                            {candidate.version}
                                        </span>
                                    )}
                                    <Badge variant="secondary">
                                        {originLabel(candidate.origin)}
                                    </Badge>
                                    {index === info.selected && (
                                        <Badge>
                                            {t('extensions_tab.in_use')}
                                        </Badge>
                                    )}
                                </span>
                                <span
                                    title={candidate.path}
                                    className="break-all font-mono text-muted-foreground"
                                >
                                    {candidate.path}
                                </span>
                                {candidate.problem !== null && (
                                    <span className="text-destructive">
                                        {reason(candidate.problem)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {logError !== null && (
                <p role="alert" className="text-xs text-destructive">
                    {logError}
                </p>
            )}
            {log !== null && (
                <pre
                    aria-label={t('extensions_tab.log')}
                    className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs"
                >
                    {log.length === 0
                        ? t('extensions_tab.log_empty')
                        : log.join('\n')}
                </pre>
            )}
        </div>
    );
}

/** Settings tab "Extensions": the language servers the app can drive (rust-analyzer, Intelephense, csharp-ls), found in the VS Code extensions already installed or on PATH. */
export function ExtensionsTab() {
    const [servers, setServers] = useState<LanguageServerInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { confirm, dialog } = useConfirm();

    const load = useCallback(async () => {
        try {
            setServers(await ideLanguageServer.list());
            setError(null);
        } catch (failure) {
            setError(String(failure));
        }
    }, []);

    useEffect(() => {
        let stop: (() => void) | undefined;
        let active = true;

        void load();

        // * A server that started, stopped or failed changes its row. Outside Tauri `listen` fails and the tab keeps what it loaded.
        try {
            void ideLanguageServer
                .onStatus(() => void load())
                .then((unlisten) => {
                    if (active) {
                        stop = unlisten;
                    } else {
                        unlisten();
                    }
                })
                .catch(() => {});
        } catch {
            // * No backend to listen to.
        }

        return () => {
            active = false;
            stop?.();
        };
    }, [load]);

    const run = async (
        info: LanguageServerInfo,
        job: () => Promise<unknown>,
    ) => {
        setBusyId(info.id);

        try {
            await job();
            await load();
        } catch (failure) {
            toast.error(String(failure));
        } finally {
            setBusyId(null);
        }
    };

    const configure = (
        info: LanguageServerInfo,
        enabled: boolean,
        source: ServerSourceSetting,
        extensionRoot: ExtensionRoot | null,
    ) =>
        run(info, async () => {
            const saved = await ideLanguageServer.configure(
                info.id,
                enabled,
                source,
                extensionRoot,
            );

            setServers(
                (current) =>
                    current?.map((item) =>
                        item.id === saved.id ? saved : item,
                    ) ?? current,
            );
        });

    const toggle = async (info: LanguageServerInfo, enabled: boolean) => {
        // * A server runs the project's own build scripts, proc-macros and MSBuild tasks: switching it on is a decision.
        if (
            enabled &&
            !(await confirm({
                title: t('extensions_tab.enable_title', { name: info.name }),
                description:
                    t('extensions_tab.enable_warning') +
                    (info.id === 'intelephense'
                        ? ` ${t('extensions_tab.intelephense_license')}`
                        : ''),
                action: t('extensions_tab.enable_action'),
            }))
        ) {
            return;
        }

        await configure(info, enabled, info.source, info.extensionRoot);
    };

    if (error !== null && servers === null) {
        return (
            <p role="alert" className="text-sm text-destructive">
                {t('extensions_tab.load_failed')} {error}
            </p>
        );
    }

    if (servers === null) {
        return (
            <p className="text-sm text-muted-foreground">
                {t('common.loading')}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {dialog}
            <p className="text-xs text-muted-foreground">
                {t('extensions_tab.intro')}
            </p>
            <div className="overflow-x-auto rounded-md border text-xs">
                <table className="w-full text-left">
                    <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                            <th className="px-2 py-1.5 font-medium">
                                {t('extensions_tab.language')}
                            </th>
                            <th className="px-2 py-1.5 font-medium">
                                {t('extensions_tab.server')}
                            </th>
                            <th className="w-full px-2 py-1.5 font-medium">
                                {t('extensions_tab.source_in_use')}
                            </th>
                            <th className="px-2 py-1.5 font-medium">
                                {t('extensions_tab.state')}
                            </th>
                            <th className="px-2 py-1.5 font-medium">
                                {t('extensions_tab.enabled')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {servers.map((info) => {
                            const candidate = selectedCandidate(info);
                            const open = openId === info.id;

                            return (
                                <Fragment key={info.id}>
                                    <tr
                                        className="cursor-pointer border-t hover:bg-muted/30"
                                        onClick={() =>
                                            setOpenId(open ? null : info.id)
                                        }
                                    >
                                        <td className="px-2 py-1.5">
                                            {info.languages.join(', ')}
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <button
                                                type="button"
                                                aria-expanded={open}
                                                className="font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                            >
                                                {info.name}
                                            </button>
                                        </td>
                                        <td className="px-2 py-1.5">
                                            {candidate === null ? (
                                                <Badge variant="outline">
                                                    {t(
                                                        'extensions_tab.not_installed',
                                                    )}
                                                </Badge>
                                            ) : (
                                                <span className="flex flex-wrap items-center gap-2">
                                                    <Badge variant="secondary">
                                                        {originLabel(
                                                            candidate.origin,
                                                        )}
                                                    </Badge>
                                                    <span>
                                                        {candidate.label}
                                                        {candidate.version !==
                                                        null
                                                            ? ` ${candidate.version}`
                                                            : ''}
                                                    </span>
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <Badge
                                                variant={
                                                    STATE_VARIANT[info.state]
                                                }
                                            >
                                                {t(
                                                    `extensions_tab.state_${info.state}`,
                                                )}
                                            </Badge>
                                        </td>
                                        <td
                                            className="px-2 py-1.5"
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                        >
                                            <Switch
                                                aria-label={t(
                                                    'extensions_tab.enable_server',
                                                    { name: info.name },
                                                )}
                                                checked={info.enabled}
                                                disabled={busyId === info.id}
                                                onCheckedChange={(checked) =>
                                                    void toggle(info, checked)
                                                }
                                            />
                                        </td>
                                    </tr>
                                    {open && (
                                        <tr className="border-t bg-muted/20">
                                            <td colSpan={5}>
                                                <ServerDetail
                                                    info={info}
                                                    busy={busyId === info.id}
                                                    onConfigure={(
                                                        source,
                                                        extensionRoot,
                                                    ) =>
                                                        void configure(
                                                            info,
                                                            info.enabled,
                                                            source,
                                                            extensionRoot,
                                                        )
                                                    }
                                                    onRestart={() =>
                                                        void run(info, () =>
                                                            ideLanguageServer.restart(
                                                                null,
                                                                info.id,
                                                            ),
                                                        )
                                                    }
                                                    onStop={() =>
                                                        void run(info, () =>
                                                            ideLanguageServer.stop(
                                                                null,
                                                                info.id,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
