import { AccountList } from '@/components/shell/accounts';
import { useAuthStatus } from '@/hooks/use-auth-status';

/** Settings tab "Kết nối": accounts to connect through each tool's own login (Claude, ChatGPT and GitHub); the state is re-read while the tab is open. */
export function ConnectTab({
    onSubpage,
}: {
    onSubpage: (open: boolean) => void;
}) {
    const { statuses, error, refresh } = useAuthStatus(true);

    if (error !== null) {
        return <p className="text-sm text-destructive">{error}</p>;
    }

    if (statuses === null) {
        return (
            <p className="text-sm text-muted-foreground">Đang kiểm tra...</p>
        );
    }

    return (
        <AccountList
            intro={
                <p className="text-sm text-muted-foreground">
                    Đăng nhập chạy lệnh của chính công cụ (`claude`, `codex`,
                    `gh`), Rynox không thấy mật khẩu hay token.
                </p>
            }
            statuses={statuses}
            onChanged={() => void refresh()}
            onSubpage={onSubpage}
        />
    );
}
