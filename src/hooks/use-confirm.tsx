import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { t } from '@/lib/i18n';

type Ask = { title: string; description: string; action: string };

/**
 * An in-app confirmation popup instead of the browser's `window.confirm`: `confirm(...)` resolves to true when the person presses the action, false on cancel or when the popup is closed.
 * Render the returned `dialog` once next to the component that calls `confirm`.
 */
export function useConfirm(): {
    confirm: (ask: Ask) => Promise<boolean>;
    dialog: ReactNode;
} {
    const [ask, setAsk] = useState<Ask | null>(null);
    const resolver = useRef<((answer: boolean) => void) | null>(null);

    const settle = (answer: boolean) => {
        resolver.current?.(answer);
        resolver.current = null;
        setAsk(null);
    };

    const confirm = (next: Ask) =>
        new Promise<boolean>((resolve) => {
            resolver.current?.(false);
            resolver.current = resolve;
            setAsk(next);
        });

    const dialog = (
        <AlertDialog
            open={ask !== null}
            onOpenChange={(open) => !open && settle(false)}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {ask?.description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => settle(true)}>
                        {ask?.action}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );

    return { confirm, dialog };
}
