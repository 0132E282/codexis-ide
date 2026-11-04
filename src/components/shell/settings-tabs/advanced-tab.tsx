import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ideAuth } from '@/lib/ide-auth';
import { ideProfiles } from '@/lib/ide-profiles';
import { ideUsage } from '@/lib/ide-usage';
import { MAX_MODEL_LENGTH } from '@/lib/ide-settings';
import type { ChatSettings } from '@/lib/ide-settings';

const CLI_OPTIONS: { value: ChatSettings['defaultCli']; label: string }[] = [
    { value: '', label: 'Hỏi mỗi lần' },
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
];

const CLI_LABELS = { claude: 'Claude', codex: 'Codex' } as const;

/** Ordered list of the CLIs tried one after another; drag a row or use the arrows to reorder. */
function FallbackOrder({
    order,
    onChange,
}: {
    order: ChatSettings['fallbackOrder'];
    onChange: (order: ChatSettings['fallbackOrder']) => void;
}) {
    const [dragged, setDragged] = useState<number | null>(null);
    const move = (from: number, to: number) => {
        if (to < 0 || to >= order.length || from === to) {
            return;
        }

        const next = [...order];

        next.splice(to, 0, next.splice(from, 1)[0]);
        onChange(next);
    };

    return (
        <ol className="flex flex-col gap-1.5">
            {order.map((cli, index) => (
                <li
                    key={cli}
                    draggable
                    onDragStart={() => setDragged(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                        if (dragged !== null) {
                            move(dragged, index);
                        }

                        setDragged(null);
                    }}
                    onDragEnd={() => setDragged(null)}
                    className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm"
                >
                    <GripVertical
                        aria-hidden="true"
                        className="size-4 cursor-grab text-muted-foreground"
                    />
                    <span className="w-5 text-muted-foreground">
                        {index + 1}.
                    </span>
                    <span className="flex-1 font-medium">
                        {CLI_LABELS[cli]}
                    </span>
                    <button
                        type="button"
                        aria-label={`Đưa ${CLI_LABELS[cli]} lên`}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                        className="rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                        <ArrowUp aria-hidden="true" className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label={`Đưa ${CLI_LABELS[cli]} xuống`}
                        disabled={index === order.length - 1}
                        onClick={() => move(index, index + 1)}
                        className="rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                        <ArrowDown aria-hidden="true" className="size-4" />
                    </button>
                </li>
            ))}
        </ol>
    );
}

/** Signed-in accounts of the AI CLIs, and how many of them stopped at their limit: the last limit error of an account is newer than its last successful turn. */
function AccountBalance() {
    const [counts, setCounts] = useState<{
        connected: number;
        exhausted: number;
    } | null>(null);

    useEffect(() => {
        let cancelled = false;

        ideProfiles
            .list()
            .then(async (all) => {
                const accounts = all.filter(
                    (profile) =>
                        profile.cli === 'claude' || profile.cli === 'codex',
                );
                const read = await Promise.all(
                    accounts.map(async (profile) => {
                        const cli = profile.cli as 'claude' | 'codex';
                        const [status, usage] = await Promise.all([
                            ideAuth.statusProfile(cli, profile.id),
                            ideUsage.statsProfile(cli, profile.id),
                        ]);

                        return status.loggedIn ? usage.limitReached : null;
                    }),
                );
                const connected = read.filter((item) => item !== null);

                if (!cancelled) {
                    setCounts({
                        connected: connected.length,
                        exhausted: connected.filter(Boolean).length,
                    });
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, []);

    if (counts === null) {
        return null;
    }

    return (
        <p className="text-sm">
            Hết token:{' '}
            <strong className="text-red-500">{counts.exhausted}</strong> tài
            khoản · Còn:{' '}
            <strong className="text-green-500">
                {counts.connected - counts.exhausted}
            </strong>{' '}
            tài khoản
        </p>
    );
}

/** Settings tab "Nâng cao": which CLI chats use by default and the model each CLI runs. */
export function AdvancedTab({
    settings,
    onChange,
}: {
    settings: ChatSettings;
    onChange: (settings: ChatSettings) => void;
}) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
                <Label>CLI mặc định</Label>
                <div
                    role="radiogroup"
                    aria-label="CLI mặc định"
                    className="flex flex-wrap gap-1.5"
                >
                    {CLI_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={settings.defaultCli === option.value}
                            onClick={() =>
                                onChange({
                                    ...settings,
                                    defaultCli: option.value,
                                })
                            }
                            className={`h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                                settings.defaultCli === option.value
                                    ? 'border-primary bg-accent'
                                    : 'hover:bg-muted'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="settings-claude-model">
                        Mô hình Claude
                    </Label>
                    <Input
                        id="settings-claude-model"
                        value={settings.claudeModel}
                        maxLength={MAX_MODEL_LENGTH}
                        placeholder="Mặc định của CLI"
                        onChange={(event) =>
                            onChange({
                                ...settings,
                                claudeModel: event.target.value,
                            })
                        }
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="settings-codex-model">Mô hình Codex</Label>
                    <Input
                        id="settings-codex-model"
                        value={settings.codexModel}
                        maxLength={MAX_MODEL_LENGTH}
                        placeholder="Mặc định của CLI"
                        onChange={(event) =>
                            onChange({
                                ...settings,
                                codexModel: event.target.value,
                            })
                        }
                    />
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                        type="checkbox"
                        checked={settings.fallbackEnabled}
                        onChange={(event) =>
                            onChange({
                                ...settings,
                                fallbackEnabled: event.target.checked,
                            })
                        }
                    />
                    Tự chuyển AI khi hết hạn mức
                </label>
                <p className="text-xs text-muted-foreground">
                    Khi một AI báo hết hạn mức, tin nhắn được gửi lại cho AI kế
                    tiếp trong danh sách. Hết cả danh sách thì báo lỗi. AI mới
                    bắt đầu cuộc trò chuyện riêng của nó nên không thấy các lượt
                    trước.
                </p>
                <AccountBalance />
                {settings.fallbackEnabled && (
                    <FallbackOrder
                        order={settings.fallbackOrder}
                        onChange={(fallbackOrder) =>
                            onChange({ ...settings, fallbackOrder })
                        }
                    />
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                Để trống mô hình thì CLI tự chọn mô hình mặc định của nó.
            </p>
        </div>
    );
}
