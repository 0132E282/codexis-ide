import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorText } from '@/lib/ide';
import { ideAuth, type AuthStatus, type LimitUsage } from '@/lib/ide-auth';
import { LIMIT_LABELS, formatReset, limitColor } from '@/lib/limit-usage';
import { ideUsage, type CliUsage } from '@/lib/ide-usage';
import { ideProfiles, type Profile, type ProfileCli } from '@/lib/ide-profiles';
import type { ReactNode } from 'react';

// * Account 0 is the CLI's own login on this machine; the others were added through a browser login.
const DEFAULT_PROFILE = 0;

const PROVIDER: Record<ProfileCli, string> = {
    claude: 'Anthropic',
    codex: 'ChatGPT',
    github: 'GitHub',
};

// * A login finishes in the browser, outside the app, so the accounts are re-read while the page is open.
const POLL_MILLISECONDS = 3000;

const formatTokens = (value: number): string =>
    new Intl.NumberFormat('vi', { notation: 'compact' }).format(value);

// * Turns and tokens (about four characters each) of the last 24 hours and 7 days; the limit note comes last.
const describeUsage = (usage: CliUsage): string[] =>
    usage.turns7d === 0
        ? ['Chưa dùng']
        : [
              `24h: ${usage.turns24h} lượt · ${formatTokens(usage.tokens24h)}`,
              `7d: ${usage.turns7d} lượt · ${formatTokens(usage.tokens7d)}`,
              ...(usage.limitReached ? ['Đạt limit'] : []),
          ];

/** "Quản lý tài khoản": the accounts of one AI CLI, which one chats, and and a "Thêm mới" popup to log in, use the CLI's own login or enter an API key (`apiKey`, when the tool has one). */
export function ManageAccountsPage({
    cli,
    title,
    onBack,
    onChanged,
    apiKey,
}: {
    cli: ProfileCli;
    title: string;
    onBack: () => void;
    /** Called after the accounts changed, so the list outside re-reads its state. */
    onChanged: () => void;
    /** The API-key form of the tool; without it the "Nhập API" choice is not offered. */
    apiKey?: ReactNode;
}) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [statuses, setStatuses] = useState<Record<number, AuthStatus>>({});
    const [usages, setUsages] = useState<Record<number, CliUsage>>({});
    // * Claude's own `/usage` is slow, so it is read once per signed-in account, not with the polling above.
    const [limits, setLimits] = useState<Record<number, LimitUsage[] | null>>(
        {},
    );
    const requested = useRef(new Set<number>());
    const [detailId, setDetailId] = useState<number | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [code, setCode] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(
        () =>
            ideProfiles
                .list()
                .then(async (all) => {
                    const mine = all.filter((profile) => profile.cli === cli);
                    const read = await Promise.all(
                        mine.map((profile) =>
                            ideAuth.statusProfile(cli, profile.id),
                        ),
                    );
                    const used =
                        cli === 'github'
                            ? []
                            : await Promise.all(
                                  mine.map((profile) =>
                                      ideUsage.statsProfile(cli, profile.id),
                                  ),
                              );

                    setProfiles(mine);
                    setUsages(
                        Object.fromEntries(
                            used.map((usage, index) => [mine[index].id, usage]),
                        ),
                    );
                    setStatuses(
                        Object.fromEntries(
                            mine.map((profile, index) => [
                                profile.id,
                                read[index],
                            ]),
                        ),
                    );
                })
                .catch((caught) => setError(errorText(caught))),
        [cli],
    );

    useEffect(() => {
        void load();

        const timer = window.setInterval(() => void load(), POLL_MILLISECONDS);

        return () => window.clearInterval(timer);
    }, [load]);

    const signedIn = profiles
        .filter((profile) => statuses[profile.id]?.loggedIn)
        .map((profile) => profile.id)
        .join(',');

    useEffect(() => {
        if (cli !== 'claude') {
            return;
        }

        for (const id of signedIn.split(',').filter(Boolean).map(Number)) {
            if (requested.current.has(id)) {
                continue;
            }

            requested.current.add(id);
            ideAuth
                .claudeUsage(id)
                .then((read) => setLimits((all) => ({ ...all, [id]: read })))
                .catch(() => setLimits((all) => ({ ...all, [id]: null })));
        }
    }, [cli, signedIn]);

    const detail = detailId === null ? undefined : statuses[detailId];

    // * An account without an email yet is named by hand, right in its row.
    const rename = (profile: Profile, name: string) => {
        const next = name.trim();

        if (next !== '' && next !== profile.name) {
            run(ideProfiles.rename(cli, profile.id, next));
        }
    };

    const run = (action: Promise<unknown>) => {
        setBusy(true);
        setError(null);
        action
            .then(() => load())
            .then(onChanged)
            .catch((caught) => setError(errorText(caught)))
            .finally(() => setBusy(false));
    };

    // * GitHub's login is finished by typing a one-time code in the browser, so the code is shown on the page.
    const login = (id: number) =>
        ideAuth.login(cli, id).then((oneTimeCode) => setCode(oneTimeCode));

    // * The account is named "Tài khoản N" and shows the email the provider reports once the browser login finishes.
    const add = () =>
        run(
            ideProfiles
                .add(cli, `Tài khoản ${profiles.length + 1}`)
                .then(async (all) => {
                    const created = all
                        .filter((profile) => profile.cli === cli)
                        .at(-1);

                    setAddOpen(false);

                    if (created !== undefined) {
                        await login(created.id);
                    }
                }),
        );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Quay lại"
                    title="Quay lại"
                    onClick={onBack}
                    className="text-muted-foreground"
                >
                    <ArrowLeft aria-hidden="true" />
                </Button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h2 className="text-base font-semibold">
                        Quản lý tài khoản {title}
                    </h2>
                </div>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => setAddOpen(true)}
                >
                    <Plus aria-hidden="true" />
                    Thêm mới
                </Button>
            </div>
            <div className="flex flex-col gap-4">
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                                <th className="px-2 py-2 font-medium whitespace-nowrap">
                                    Tài khoản
                                </th>
                                <th className="px-2 py-2 font-medium whitespace-nowrap">
                                    Loại kết nối
                                </th>
                                <th className="px-2 py-2 font-medium whitespace-nowrap">
                                    Trạng thái
                                </th>
                                {cli !== 'github' && (
                                    <th className="px-2 py-2 font-medium whitespace-nowrap">
                                        Usage
                                    </th>
                                )}
                                <th className="w-px px-2 py-2 text-right font-medium whitespace-nowrap">
                                    Thao tác
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {profiles.map((profile) => {
                                const status = statuses[profile.id];

                                return (
                                    <tr
                                        key={profile.id}
                                        className="border-t align-middle"
                                    >
                                        <td className="w-[400px] max-w-[400px] px-2 py-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                                {status?.account ===
                                                    undefined &&
                                                profile.id !==
                                                    DEFAULT_PROFILE ? (
                                                    <input
                                                        key={`${profile.id}-${profile.name}`}
                                                        defaultValue={
                                                            profile.name
                                                        }
                                                        maxLength={40}
                                                        aria-label="Tên tài khoản"
                                                        disabled={busy}
                                                        onBlur={(event) =>
                                                            rename(
                                                                profile,
                                                                event
                                                                    .currentTarget
                                                                    .value,
                                                            )
                                                        }
                                                        onKeyDown={(event) => {
                                                            if (
                                                                event.key ===
                                                                'Enter'
                                                            ) {
                                                                event.currentTarget.blur();
                                                            }
                                                        }}
                                                        className="h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="truncate rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                                        title="Xem chi tiết"
                                                        onClick={() =>
                                                            setDetailId(
                                                                profile.id,
                                                            )
                                                        }
                                                    >
                                                        {status?.account ??
                                                            profile.name}
                                                    </button>
                                                )}
                                                {profile.active && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="shrink-0"
                                                    >
                                                        Đang dùng
                                                    </Badge>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            {profile.id === DEFAULT_PROFILE
                                                ? 'CLI'
                                                : 'Authentication'}
                                        </td>
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            {status === undefined ? (
                                                '...'
                                            ) : !status.installed ? (
                                                'Chưa cài CLI'
                                            ) : status.loggedIn ? (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span
                                                        aria-hidden="true"
                                                        className="size-1.5 rounded-full bg-green-500"
                                                    />
                                                    Đang kết nối
                                                </span>
                                            ) : (
                                                'Chưa kết nối'
                                            )}
                                        </td>
                                        {cli !== 'github' && (
                                            <td className="px-2 py-2 text-xs whitespace-nowrap text-muted-foreground">
                                                {cli === 'claude' &&
                                                limits[profile.id] !== undefined
                                                    ? (limits[profile.id]?.map(
                                                          (limit) => (
                                                              <div
                                                                  key={
                                                                      limit.label
                                                                  }
                                                                  className="flex items-center gap-2 py-0.5"
                                                                  title={
                                                                      limit.resets ===
                                                                      null
                                                                          ? undefined
                                                                          : `Đặt lại ${formatReset(limit.resets)}`
                                                                  }
                                                              >
                                                                  <span className="w-9 shrink-0">
                                                                      {LIMIT_LABELS[
                                                                          limit
                                                                              .label
                                                                      ] ??
                                                                          limit.label}
                                                                  </span>
                                                                  <span
                                                                      role="progressbar"
                                                                      aria-valuenow={
                                                                          limit.percent
                                                                      }
                                                                      aria-valuemin={
                                                                          0
                                                                      }
                                                                      aria-valuemax={
                                                                          100
                                                                      }
                                                                      className="relative h-1 w-24 shrink-0 rounded-full bg-muted"
                                                                  >
                                                                      <span
                                                                          className={`absolute inset-y-0 left-0 rounded-full ${limitColor(limit.percent)}`}
                                                                          style={{
                                                                              width: `${limit.percent}%`,
                                                                          }}
                                                                      />
                                                                  </span>
                                                                  <span className="w-8 shrink-0 text-right">
                                                                      {
                                                                          limit.percent
                                                                      }
                                                                      %
                                                                  </span>
                                                                  {limit.resets !==
                                                                      null && (
                                                                      <span className="text-[11px] opacity-70">
                                                                          Đặt
                                                                          lại{' '}
                                                                          {formatReset(
                                                                              limit.resets,
                                                                          )}
                                                                      </span>
                                                                  )}
                                                              </div>
                                                          ),
                                                      ) ?? 'Chưa đọc được')
                                                    : usages[profile.id] ===
                                                            undefined ||
                                                        (cli === 'claude' &&
                                                            statuses[profile.id]
                                                                ?.loggedIn)
                                                      ? '...'
                                                      : describeUsage(
                                                            usages[profile.id],
                                                        ).map((line) => (
                                                            <div key={line}>
                                                                {line}
                                                            </div>
                                                        ))}
                                            </td>
                                        )}
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            <div className="flex items-center justify-end gap-1">
                                                {status?.installed &&
                                                    !status.loggedIn && (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(
                                                                    login(
                                                                        profile.id,
                                                                    ),
                                                                )
                                                            }
                                                        >
                                                            Kết nối lại
                                                        </Button>
                                                    )}
                                                {(profile.id !==
                                                    DEFAULT_PROFILE ||
                                                    (!profile.active &&
                                                        status?.loggedIn)) && (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger
                                                            asChild
                                                        >
                                                            <Button
                                                                type="button"
                                                                size="icon-sm"
                                                                variant="ghost"
                                                                aria-label="Thao tác"
                                                                title="Thao tác"
                                                                disabled={busy}
                                                            >
                                                                <MoreHorizontal aria-hidden="true" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {!profile.active &&
                                                                status?.loggedIn && (
                                                                    <DropdownMenuItem
                                                                        onSelect={() =>
                                                                            run(
                                                                                ideProfiles.select(
                                                                                    cli,
                                                                                    profile.id,
                                                                                ),
                                                                            )
                                                                        }
                                                                    >
                                                                        Dùng
                                                                    </DropdownMenuItem>
                                                                )}
                                                            {profile.id !==
                                                                DEFAULT_PROFILE &&
                                                                status?.loggedIn && (
                                                                    <DropdownMenuItem
                                                                        onSelect={() =>
                                                                            run(
                                                                                ideAuth.logout(
                                                                                    cli,
                                                                                    profile.id,
                                                                                ),
                                                                            )
                                                                        }
                                                                    >
                                                                        Ngắt kết
                                                                        nối
                                                                    </DropdownMenuItem>
                                                                )}
                                                            {profile.id !==
                                                                DEFAULT_PROFILE && (
                                                                <DropdownMenuItem
                                                                    variant="destructive"
                                                                    onSelect={() =>
                                                                        run(
                                                                            ideProfiles.remove(
                                                                                cli,
                                                                                profile.id,
                                                                            ),
                                                                        )
                                                                    }
                                                                >
                                                                    Xóa
                                                                </DropdownMenuItem>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {code !== null && (
                    <p className="text-xs">
                        Nhập mã <strong className="font-mono">{code}</strong>{' '}
                        tại github.com/login/device (trình duyệt sẽ tự mở).
                    </p>
                )}
                {error !== null && (
                    <p role="alert" className="text-xs text-destructive">
                        {error}
                    </p>
                )}
            </div>
            <Dialog
                open={detailId !== null}
                onOpenChange={(open) => !open && setDetailId(null)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {detail?.account ?? 'Chi tiết tài khoản'}
                        </DialogTitle>
                        <DialogDescription>
                            Thông tin do chính công cụ báo cáo; không hiển thị
                            token hay khóa.
                        </DialogDescription>
                    </DialogHeader>
                    {detail !== undefined && (
                        <div className="overflow-x-auto rounded-md border">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-muted/50 text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">
                                            Mục
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Giá trị
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        {
                                            label: 'Trạng thái',
                                            value: !detail.installed
                                                ? 'Chưa cài'
                                                : detail.loggedIn
                                                  ? 'Đã kết nối'
                                                  : 'Chưa kết nối',
                                        },
                                        ...detail.details,
                                    ].map((row) => (
                                        <tr
                                            key={row.label}
                                            className="border-t"
                                        >
                                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                                                {row.label}
                                            </td>
                                            <td className="px-3 py-2 break-all">
                                                {row.value}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Thêm mới tài khoản {title}</DialogTitle>
                        <DialogDescription>
                            Chọn cách kết nối.
                        </DialogDescription>
                    </DialogHeader>
                    <Tabs defaultValue="login">
                        <TabsList>
                            <TabsTrigger value="login">Đăng nhập</TabsTrigger>
                            {apiKey !== undefined && (
                                <TabsTrigger value="api">Nhập API</TabsTrigger>
                            )}
                        </TabsList>
                        <TabsContent
                            value="login"
                            className="flex flex-col gap-3 pt-3"
                        >
                            <p className="text-muted-foreground">
                                Mở trang đăng nhập của {PROVIDER[cli]} trong
                                trình duyệt. Đăng nhập xong, Rynox tự lấy thông
                                tin tài khoản.
                            </p>
                            <Button
                                type="button"
                                className="self-start"
                                disabled={busy}
                                onClick={add}
                            >
                                Đăng nhập bằng {PROVIDER[cli]}
                            </Button>
                        </TabsContent>
                        {apiKey !== undefined && (
                            <TabsContent value="api" className="pt-3">
                                {apiKey}
                            </TabsContent>
                        )}
                    </Tabs>
                    {error !== null && (
                        <p role="alert" className="text-xs text-destructive">
                            {error}
                        </p>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
