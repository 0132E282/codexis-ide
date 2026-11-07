import { ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import Field from '@/components/form/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    errorText,
    ide,
    pickFolders,
    type EnvVar,
    type Project,
} from '@/lib/ide';
import { t } from '@/lib/i18n';
import {
    DISPLAY_NAME_MAX_LENGTH,
    ENV_KEY_MAX_LENGTH,
    ENV_VALUE_MAX_LENGTH,
} from '@/lib/limits';

const UNSUPPORTED = 'new_project_dialog.not_supported_in_this';

/** Dialog "Dự án mới": only the Local tab works, the others say so. Creates the project through the backend and reports it. */
export function NewProjectDialog({
    onCreated,
    children,
}: {
    onCreated: (project: Project) => void;
    /** The button that opens the dialog. */
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('local');
    const [name, setName] = useState('');
    const [folders, setFolders] = useState<string[]>([]);
    const [env, setEnv] = useState<EnvVar[]>([]);
    const [envOpen, setEnvOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setName('');
        setFolders([]);
        setEnv([]);
        setEnvOpen(false);
        setError(null);
        setTab('local');
    };

    const changeOpen = (next: boolean) => {
        setOpen(next);

        if (!next) {
            reset();
        }
    };

    const addFolders = async () => {
        try {
            const chosen = await pickFolders();

            setFolders((current) => [
                ...current,
                ...chosen.filter((folder) => !current.includes(folder)),
            ]);
            // * The title defaults to the name of the first folder picked, unless one was typed.
            setName((current) =>
                current.trim() === ''
                    ? (chosen[0]?.split(/[\\/]/).filter(Boolean).pop() ?? '')
                    : current,
            );
        } catch (caught) {
            setError(errorText(caught));
        }
    };

    const updateEnv = (index: number, change: Partial<EnvVar>) =>
        setEnv((current) =>
            current.map((entry, at) =>
                at === index ? { ...entry, ...change } : entry,
            ),
        );

    const keys = env.map((entry) => entry.key.trim());
    const envProblem = keys.some(
        (key, index) =>
            key === '' ||
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
            keys.indexOf(key) !== index,
    );
    const valid = name.trim() !== '' && !envProblem;

    const create = async () => {
        setSaving(true);
        setError(null);

        try {
            const project = await ide.addProject({
                name: name.trim(),
                folders,
                env: env.map((entry) => ({
                    key: entry.key.trim(),
                    value: entry.value,
                })),
            });

            onCreated(project);
            changeOpen(false);
        } catch (caught) {
            setError(errorText(caught));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={changeOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="gap-3 p-0 sm:max-w-2xl">
                <DialogHeader className="px-4 pt-4">
                    <DialogTitle className="text-base">
                        {t('new_project_dialog.new_environment')}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {t('new_project_dialog.create_aproject_to')}
                    </DialogDescription>
                </DialogHeader>
                <Tabs value={tab} onValueChange={setTab} className="gap-3 px-4">
                    <TabsList variant="line" className="-ml-1">
                        <TabsTrigger value="local">Local</TabsTrigger>
                        <TabsTrigger value="cloud">Cloud</TabsTrigger>
                        <TabsTrigger value="ssh">SSH</TabsTrigger>
                        <TabsTrigger value="remote">Remote Control</TabsTrigger>
                    </TabsList>
                    <TabsContent value="local" className="grid gap-4">
                        <Field
                            name="project-name"
                            label={t('common.name')}
                            autoComplete="off"
                            value={name}
                            maxLength={DISPLAY_NAME_MAX_LENGTH}
                            placeholder={t('new_project_dialog.my_app')}
                            onChange={(event) => setName(event.target.value)}
                        />
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                    {t('new_project_dialog.folders')}{' '}
                                    <span className="font-normal text-muted-foreground">
                                        {t('new_project_dialog.optional')}
                                    </span>
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void addFolders()}
                                >
                                    <Plus aria-hidden="true" />
                                    {t('common.add')}
                                </Button>
                            </div>
                            {folders.length === 0 ? (
                                <p className="rounded-sm border border-dashed px-3 py-3 text-sm text-muted-foreground">
                                    {t(
                                        'new_project_dialog.choose_the_folders_the',
                                    )}
                                </p>
                            ) : (
                                <ul className="grid gap-1">
                                    {folders.map((folder) => (
                                        <li
                                            key={folder}
                                            className="flex items-center gap-2 rounded-sm border px-3 py-1.5"
                                        >
                                            <span
                                                title={folder}
                                                className="min-w-0 flex-1 truncate text-sm"
                                            >
                                                {folder}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-label={t(
                                                    'new_project_dialog.remove_folder_name',
                                                    {
                                                        name: folder,
                                                    },
                                                )}
                                                onClick={() =>
                                                    setFolders((current) =>
                                                        current.filter(
                                                            (item) =>
                                                                item !== folder,
                                                        ),
                                                    )
                                                }
                                            >
                                                <X aria-hidden="true" />
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="rounded-sm border">
                            <button
                                type="button"
                                aria-expanded={envOpen}
                                onClick={() =>
                                    setEnvOpen((current) => !current)
                                }
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium">
                                        {t(
                                            'new_project_dialog.environment_variables',
                                        )}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {env.length === 0
                                            ? t('new_project_dialog.none')
                                            : t(
                                                  'new_project_dialog.count_variables',
                                                  {
                                                      count: env.length,
                                                  },
                                              )}
                                    </span>
                                </span>
                                <ChevronRight
                                    aria-hidden="true"
                                    className={`size-4 text-muted-foreground transition-transform ${envOpen ? 'rotate-90' : ''}`}
                                />
                            </button>
                            {envOpen && (
                                <div className="grid gap-2 border-t p-3">
                                    {env.map((entry, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center gap-2"
                                        >
                                            <Field
                                                name={`env-key-${index}`}
                                                className="min-w-0 flex-1"
                                                autoComplete="off"
                                                value={entry.key}
                                                maxLength={ENV_KEY_MAX_LENGTH}
                                                aria-label={t(
                                                    'new_project_dialog.variable_name',
                                                )}
                                                placeholder={t(
                                                    'new_project_dialog.var_name',
                                                )}
                                                onChange={(event) =>
                                                    updateEnv(index, {
                                                        key: event.target.value,
                                                    })
                                                }
                                            />
                                            <Field
                                                name={`env-value-${index}`}
                                                className="min-w-0 flex-1"
                                                value={entry.value}
                                                maxLength={ENV_VALUE_MAX_LENGTH}
                                                aria-label={t('common.value')}
                                                placeholder={t(
                                                    'new_project_dialog.value',
                                                )}
                                                autoComplete="off"
                                                onChange={(event) =>
                                                    updateEnv(index, {
                                                        value: event.target
                                                            .value,
                                                    })
                                                }
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={t(
                                                    'new_project_dialog.delete_variable',
                                                )}
                                                onClick={() =>
                                                    setEnv((current) =>
                                                        current.filter(
                                                            (_, at) =>
                                                                at !== index,
                                                        ),
                                                    )
                                                }
                                            >
                                                <Trash2 aria-hidden="true" />
                                            </Button>
                                        </div>
                                    ))}
                                    {envProblem && (
                                        <p className="text-xs text-destructive">
                                            {t(
                                                'new_project_dialog.variable_names_may_only',
                                            )}
                                        </p>
                                    )}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        onClick={() =>
                                            setEnv((current) => [
                                                ...current,
                                                { key: '', value: '' },
                                            ])
                                        }
                                    >
                                        <Plus aria-hidden="true" />
                                        {t('new_project_dialog.add_variable')}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                    {['cloud', 'ssh', 'remote'].map((tab) => (
                        <TabsContent key={tab} value={tab}>
                            <p className="rounded-sm border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                                {t(UNSUPPORTED)}
                            </p>
                        </TabsContent>
                    ))}
                </Tabs>
                {error !== null && (
                    <p role="alert" className="px-4 text-sm text-destructive">
                        {error}
                    </p>
                )}
                <DialogFooter className="border-t px-4 py-3">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => changeOpen(false)}
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={tab !== 'local' || !valid || saving}
                        onClick={() => void create()}
                    >
                        {t('new_project_dialog.create')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
