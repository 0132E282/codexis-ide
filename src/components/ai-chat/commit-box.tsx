import { Check, GitPullRequest, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppForm } from '@/hooks/use-app-form';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/ai-error';
import { t } from '@/lib/i18n';
import {
    COMMIT_MESSAGE_MAX_LENGTH,
    COMMIT_TITLE_MAX_LENGTH,
} from '@/lib/limits';

type MessageForm = { title: string; description: string; base: string };

/**
 * The "Commit" button in the header of the change list opens a popup: a title and a description typed as usual, or written by the AI from the diff ("Tạo bằng AI"), then one local commit of the listed files. Nothing is pushed.
 * ! "Tạo bằng AI" sends the diff of the listed files to the picked AI account, only when it is pressed.
 */
export function CommitActions({
    root,
    disabled,
    accountId,
    model,
    onCommitted,
}: {
    root: string;
    /** * No git, or nothing changed. */
    disabled: boolean;
    accountId: number | null;
    model: string | null;
    onCommitted: () => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setOpen(true)}
                className="ml-auto h-7 gap-1.5 text-xs"
            >
                <GitPullRequest aria-hidden="true" />
                Commit / Pull request
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg">
                    {open && (
                        <MessagePopup
                            root={root}
                            accountId={accountId}
                            model={model}
                            onDone={() => {
                                setOpen(false);
                                onCommitted();
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}

function MessagePopup({
    root,
    accountId,
    model,
    onDone,
}: {
    root: string;
    accountId: number | null;
    model: string | null;
    onDone: () => void;
}) {
    const form = useAppForm<MessageForm>({
        defaultValues: { title: '', description: '', base: '' },
    });
    const [busy, setBusy] = useState<'ai' | 'commit' | null>(null);
    const [mode, setMode] = useState<'commit' | 'pr'>('commit');
    const [branches, setBranches] = useState<string[]>([]);

    // * The target of a pull request is picked from the local branches (the current one first, as the default).
    useEffect(() => {
        if (mode !== 'pr' || branches.length > 0) {
            return;
        }

        void api
            .get<{ current: string | null; branches: string[] }>(
                '/ai-chat/local/branches',
                { params: { root } },
            )
            .then(({ data }) => {
                const list = [
                    ...(data.current ? [data.current] : []),
                    ...data.branches.filter((name) => name !== data.current),
                ];

                setBranches(list);
                form.setValue('base', list[0] ?? '');
            })
            .catch(() => setBranches([]));
    }, [mode, root, branches.length, form]);

    const write = async () => {
        setBusy('ai');

        try {
            const { data } = await api.post<MessageForm>(
                '/ai-chat/local/commit-message',
                { root, ai_account_id: accountId, ai_model: model },
            );

            form.setValue('title', data.title);
            form.setValue('description', data.description);
        } catch (caught) {
            toast.error(
                requestErrorMessage(caught, t('commit_box.ai_could_not_write')),
            );
        } finally {
            setBusy(null);
        }
    };

    const submit = form.handleSubmit(async ({ title, description, base }) => {
        setBusy('commit');

        try {
            // * Pull request: a new branch with these files, pushed to origin, then the PR on GitHub.
            if (mode === 'pr') {
                const { data } = await api.post<{
                    url: string;
                    branch: string;
                }>('/ai-chat/local/pull-request', {
                    root,
                    title: title.trim(),
                    body: description.trim(),
                    base: base.trim() === '' ? null : base.trim(),
                });

                toast.success(
                    t('commit_box.created_apull_request', {
                        branch: data.branch,
                    }),
                    {
                        action: {
                            label: t('commit_box.open'),
                            onClick: () =>
                                window.open(data.url, '_blank', 'noopener'),
                        },
                    },
                );
                onDone();

                return;
            }

            const { data } = await api.post<{ hash: string; files: number }>(
                '/ai-chat/local/commit',
                {
                    root,
                    message: [title.trim(), description.trim()]
                        .filter((part) => part !== '')
                        .join('\n\n'),
                },
            );

            toast.success(
                t('commit_box.committed_hash_files_files', {
                    hash: data.hash,
                    files: data.files,
                }),
            );
            onDone();
        } catch (caught) {
            toast.error(
                requestErrorMessage(
                    caught,
                    mode === 'pr'
                        ? t('commit_box.could_not_create_the')
                        : t('commit_box.could_not_commit'),
                ),
            );
        } finally {
            setBusy(null);
        }
    });

    return (
        <>
            <DialogHeader>
                <DialogTitle>{t('commit_box.commit_pull_request')}</DialogTitle>
                <DialogDescription>
                    {mode === 'commit'
                        ? t('commit_box.commit_the_changed_files')
                        : t('commit_box.create_anew_branch')}
                </DialogDescription>
            </DialogHeader>
            <Tabs
                value={mode}
                onValueChange={(value) =>
                    setMode(value === 'pr' ? 'pr' : 'commit')
                }
            >
                <TabsList className="h-8 w-full">
                    <TabsTrigger value="commit" className="text-xs">
                        Commit
                    </TabsTrigger>
                    <TabsTrigger value="pr" className="text-xs">
                        Pull request
                    </TabsTrigger>
                </TabsList>
            </Tabs>
            <Form
                form={form}
                withFieldGroup={false}
                onSubmit={submit}
                className="flex flex-col gap-2"
            >
                <Field
                    name="title"
                    placeholder={t('commit_box.title')}
                    maxLength={COMMIT_TITLE_MAX_LENGTH}
                    autoComplete="off"
                    required
                />
                <Field
                    name="description"
                    ui="textarea"
                    maxLength={COMMIT_MESSAGE_MAX_LENGTH}
                    placeholder={t('commit_box.description_optional')}
                    autoComplete="off"
                />
                {mode === 'pr' && (
                    <Field
                        name="base"
                        ui="select"
                        label={t('commit_box.target_branch')}
                    >
                        {branches.map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </Field>
                )}
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void write()}
                        className="gap-1.5"
                    >
                        {busy === 'ai' ? (
                            <Loader2
                                aria-hidden="true"
                                className="animate-spin motion-reduce:animate-none"
                            />
                        ) : (
                            <Sparkles aria-hidden="true" />
                        )}
                        {t('commit_box.generate_with_ai')}
                    </Button>
                    <Button
                        type="submit"
                        size="sm"
                        disabled={busy !== null}
                        className="ml-auto gap-1.5"
                    >
                        {busy === 'commit' ? (
                            <Loader2
                                aria-hidden="true"
                                className="animate-spin motion-reduce:animate-none"
                            />
                        ) : mode === 'pr' ? (
                            <GitPullRequest aria-hidden="true" />
                        ) : (
                            <Check aria-hidden="true" />
                        )}
                        {mode === 'pr'
                            ? t('commit_box.push_and_create_pr')
                            : t('commit_box.commit')}
                    </Button>
                </div>
            </Form>
        </>
    );
}
