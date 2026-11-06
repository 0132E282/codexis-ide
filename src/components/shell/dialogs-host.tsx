import { lazy, Suspense, useState } from 'react';
import type { SettingsTab } from '@/components/shell/settings-dialog';

// * Rarely opened: each dialog is fetched the first time it is asked for, so the first paint stays light.
const SettingsDialog = lazy(() =>
    import('@/components/shell/settings-dialog').then((module) => ({
        default: module.SettingsDialog,
    })),
);
const UsageDialog = lazy(() =>
    import('@/components/shell/usage-dialog').then((module) => ({
        default: module.UsageDialog,
    })),
);
const ConnectPhoneDialog = lazy(() =>
    import('@/components/shell/connect-phone-dialog').then((module) => ({
        default: module.ConnectPhoneDialog,
    })),
);

/** Mounts a dialog on its first request and keeps it mounted afterwards, so closing still animates. */
function useEverRequested(requested: boolean) {
    const [ever, setEver] = useState(requested);

    if (requested && !ever) {
        setEver(true);
    }

    return ever;
}

/** The settings, statistics and phone-pairing dialogs, opened from the sidebar's menu. */
export function DialogsHost({
    settingsTab,
    onSettingsTabChange,
    usageOpen,
    onUsageClose,
    phoneOpen,
    onPhoneClose,
}: {
    settingsTab: SettingsTab | null;
    onSettingsTabChange: (tab: SettingsTab | null) => void;
    usageOpen: boolean;
    onUsageClose: () => void;
    phoneOpen: boolean;
    onPhoneClose: () => void;
}) {
    const settingsLoaded = useEverRequested(settingsTab !== null);
    const usageLoaded = useEverRequested(usageOpen);
    const phoneLoaded = useEverRequested(phoneOpen);

    return (
        <Suspense fallback={null}>
            {settingsLoaded && (
                <SettingsDialog
                    tab={settingsTab}
                    onTabChange={onSettingsTabChange}
                    onClose={() => onSettingsTabChange(null)}
                />
            )}
            {usageLoaded && (
                <UsageDialog open={usageOpen} onClose={onUsageClose} />
            )}
            {phoneLoaded && (
                <ConnectPhoneDialog open={phoneOpen} onClose={onPhoneClose} />
            )}
        </Suspense>
    );
}
