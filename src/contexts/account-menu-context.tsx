import { createContext } from 'react';
import type { SettingsTab } from '@/components/shell/settings-dialog';
import type { AuthStatus } from '@/lib/ide-auth';

/** What the account menu needs, given by the app so the file tree can show that menu in its header while it is on the left. Null outside the app. */
export const AccountMenuContext = createContext<{
    github: AuthStatus | undefined;
    onOpenSettings: (tab: SettingsTab) => void;
    onOpenUsage: () => void;
} | null>(null);
