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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    errorText,
    ide,
    pickFolders,
    type EnvVar,
    type Project,
} from '@/lib/ide';

const UNSUPPORTED = 'Chưa hỗ trợ trong IDE này.';

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
                        Môi trường mới
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Tạo một dự án để mở trong IDE.
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
                        <div className="grid gap-2">
                            <Label htmlFor="project-name">Tên</Label>
                            <Input
                                id="project-name"
                                value={name}
                                maxLength={100}
                                placeholder="Ứng dụng của tôi"
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                    Thư mục{' '}
                                    <span className="font-normal text-muted-foreground">
                                        (tùy chọn)
                                    </span>
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void addFolders()}
                                >
                                    <Plus aria-hidden="true" />
                                    Thêm
                                </Button>
                            </div>
                            {folders.length === 0 ? (
                                <p className="rounded-sm border border-dashed px-3 py-3 text-sm text-muted-foreground">
                                    Chọn thư mục mà dự án sẽ mở. Thư mục đầu
                                    tiên là thư mục gốc.
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
                                                aria-label={`Bỏ thư mục ${folder}`}
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
                                        Biến môi trường
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {env.length === 0
                                            ? 'Không có'
                                            : `${env.length} biến`}
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
                                            <Input
                                                value={entry.key}
                                                aria-label="Tên biến"
                                                placeholder="TEN_BIEN"
                                                onChange={(event) =>
                                                    updateEnv(index, {
                                                        key: event.target.value,
                                                    })
                                                }
                                            />
                                            <Input
                                                value={entry.value}
                                                aria-label="Giá trị"
                                                placeholder="giá trị"
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
                                                aria-label="Xóa biến"
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
                                            Tên biến chỉ gồm chữ, số, dấu gạch
                                            dưới, không bắt đầu bằng số và không
                                            trùng nhau.
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
                                        Thêm biến
                                    </Button>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                    {['cloud', 'ssh', 'remote'].map((tab) => (
                        <TabsContent key={tab} value={tab}>
                            <p className="rounded-sm border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                                {UNSUPPORTED}
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
                        Hủy
                    </Button>
                    <Button
                        type="button"
                        disabled={tab !== 'local' || !valid || saving}
                        onClick={() => void create()}
                    >
                        Tạo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
