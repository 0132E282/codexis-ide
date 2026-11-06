import { Smartphone } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AccountList } from '@/components/shell/accounts';
import { ConnectPhoneDialog } from '@/components/shell/connect-phone-dialog';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { useAuthStatus } from '@/hooks/use-auth-status';

/** Settings tab "Kết nối": accounts to connect through each tool's own login (Claude, ChatGPT and GitHub) and the phone app; the state is re-read while the tab is open. */
export function ConnectTab({
    onSubpage,
}: {
    onSubpage: (open: boolean) => void;
}) {
    const { statuses, error, refresh } = useAuthStatus(true);
    // * The phone card belongs to the list, so it goes away while a page of one account replaces the list.
    const [subpage, setSubpage] = useState(false);
    const [phoneOpen, setPhoneOpen] = useState(false);
    const handleSubpage = useCallback(
        (open: boolean) => {
            setSubpage(open);
            onSubpage(open);
        },
        [onSubpage],
    );

    if (error !== null) {
        return <p className="text-sm text-destructive">{error}</p>;
    }

    if (statuses === null) {
        return (
            <p className="text-sm text-muted-foreground">
                {t('connect_tab.checking')}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <AccountList
                intro={
                    <p className="text-sm text-muted-foreground">
                        {t('connect_tab.sign_in_runs_each')}
                    </p>
                }
                statuses={statuses}
                onChanged={() => void refresh()}
                onSubpage={handleSubpage}
            />
            {!subpage && (
                <div className="flex items-center gap-3 rounded-md border p-3">
                    <Smartphone
                        aria-hidden="true"
                        className="size-5 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1 leading-tight">
                        <p className="font-medium">{t('connect_tab.phone')}</p>
                        <p className="truncate text-xs text-muted-foreground">
                            {t('connect_tab.scan_the_qr_code')}
                        </p>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => setPhoneOpen(true)}
                    >
                        {t('common.connect')}
                    </Button>
                </div>
            )}
            <ConnectPhoneDialog
                open={phoneOpen}
                onClose={() => setPhoneOpen(false)}
            />
        </div>
    );
}
