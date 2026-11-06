import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { t } from '@/lib/i18n';

/** A plain icon, like an editor's panel toggle: it ends the right side of the chat header (or of the file tab bar while the chat is folded). */
export function SidebarToggle({
    collapsed,
    onToggle,
}: {
    collapsed: boolean;
    onToggle: () => void;
}) {
    const label = collapsed
        ? t('sidebar_toggle.open_sidebar')
        : t('sidebar_toggle.collapse_sidebar');

    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onToggle}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
            {collapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-5" />
            ) : (
                <PanelLeftClose aria-hidden="true" className="size-5" />
            )}
        </button>
    );
}
