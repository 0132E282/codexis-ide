import { Plus, WandSparkles } from 'lucide-react';
import { NOT_AVAILABLE } from '@/components/shell/chat/inert-button';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/i18n';

/** The buttons at the left of the message box: add files, optimise. A narrow box folds them into one "+" menu. */
export function ComposerTools({
    busy,
    onAddFiles,
}: {
    busy: boolean;
    onAddFiles: () => void;
}) {
    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={t('composer_tools.add_file')}
                title={t('composer_tools.add_afile_to')}
                onClick={onAddFiles}
                className="hidden text-muted-foreground @xl:inline-flex"
            >
                <Plus aria-hidden="true" />
            </Button>
            {/* * Narrow box: the buttons below fold into this "+" menu. */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={t('common.add')}
                        className="text-muted-foreground @xl:hidden"
                    >
                        <Plus aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={onAddFiles}>
                        <Plus aria-hidden="true" />
                        {t('composer_tools.add_file')}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>
                        <WandSparkles aria-hidden="true" />
                        {t('composer_tools.optimize')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <span className="hidden items-center gap-1 @xl:flex">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled
                    title={t(NOT_AVAILABLE)}
                    className="gap-1.5 text-muted-foreground"
                >
                    <WandSparkles aria-hidden="true" />
                    {t('composer_tools.optimize')}
                </Button>
            </span>
        </>
    );
}
