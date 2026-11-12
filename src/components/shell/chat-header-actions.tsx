import { Code2, Files, SquareMenu, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** The buttons at the right end of a chat header, shared by a single chat and the chat grid: VS Code, Terminal, the session rail, the files and the panels menu. */
export function ChatHeaderActions({
    onOpenInVscode,
    terminalOpen,
    onToggleTerminal,
    railOpen,
    onToggleRail,
    filesLabel,
    filesShown,
    onToggleFiles,
    menu,
}: {
    onOpenInVscode: () => void;
    terminalOpen: boolean;
    onToggleTerminal: () => void;
    railOpen: boolean;
    onToggleRail: () => void;
    /** Text of the files button (show or hide). */
    filesLabel: string;
    /** The files are on screen: the button is pressed. */
    filesShown: boolean;
    onToggleFiles: () => void;
    /** The "..." menu of the panels. */
    menu: ReactNode;
}) {
    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.open_in_vs_code')}
                title={t('common.open_in_vs_code')}
                onClick={onOpenInVscode}
                className="text-muted-foreground"
            >
                <Code2 aria-hidden="true" className="size-4" />
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Terminal"
                aria-pressed={terminalOpen}
                onClick={onToggleTerminal}
                className={cn(
                    'text-muted-foreground',
                    terminalOpen && 'bg-accent text-accent-foreground',
                )}
            >
                <Terminal aria-hidden="true" className="size-4" />
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t(
                    railOpen ? 'session_rail.hide' : 'session_rail.show',
                )}
                title={t(railOpen ? 'session_rail.hide' : 'session_rail.show')}
                aria-expanded={railOpen}
                aria-haspopup="dialog"
                data-rail-toggle=""
                onClick={onToggleRail}
                className={cn(
                    'text-muted-foreground',
                    railOpen && 'bg-accent text-accent-foreground',
                )}
            >
                {/* * A box fills its whole square, so it is drawn smaller (14px against 16px) to look as big as the open icons beside it. */}
                <SquareMenu aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={filesLabel}
                title={filesLabel}
                aria-pressed={filesShown}
                onClick={onToggleFiles}
                className="text-muted-foreground"
            >
                <Files aria-hidden="true" className="size-4" />
            </Button>
            {menu}
        </>
    );
}
