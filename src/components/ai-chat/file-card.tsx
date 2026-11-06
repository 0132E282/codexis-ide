import {
    Download,
    Eye,
    FileCode2,
    FileImage,
    FileSpreadsheet,
    FileText,
    MoreHorizontal,
} from 'lucide-react';
import { useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileViewerContext } from '@/contexts/file-viewer-context';
import { detectFile, downloadViewerFile } from '@/lib/viewer-file';
import { t } from '@/lib/i18n';

const ICONS = {
    image: FileImage,
    code: FileCode2,
    text: FileText,
    sheet: FileSpreadsheet,
};

/**
 * A fenced block that is a file (svg, html, md, json, php, ... see `detectFile`) shown as a card instead of the long raw code; the code stays in the viewer's Code tab.
 * Outside the AI chat, for short unnamed snippets, or over the size cap, the `fallback` plain code block is rendered instead.
 */
export function FileBlock({
    code,
    language,
    name,
    fallback,
}: {
    code: string;
    language: string | undefined;
    /** Name from the block's `title="..."` meta, if any. */
    name: string | null;
    fallback: ReactNode;
}) {
    const viewer = useContext(FileViewerContext);
    const file = useMemo(
        () => (viewer ? detectFile(language, name, code) : null),
        [code, language, name, viewer],
    );

    if (!viewer || !file) {
        return fallback;
    }

    const Icon = ICONS[file.type.icon];

    return (
        <div className="@container my-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 p-3">
            {/* * Icon and name take the first line and may shrink; the buttons wrap under them when the chat is narrow instead of squeezing the text. */}
            <span className="flex min-w-0 flex-1 basis-40 items-center gap-3">
                <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                >
                    <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                    <span
                        title={file.title}
                        className="block truncate text-sm font-medium"
                    >
                        {file.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                        {file.type.kind === 'svg'
                            ? t('file_card.image_svg')
                            : t('file_card.file_label', {
                                  label: file.type.label,
                              })}
                    </span>
                </span>
            </span>
            {/* * Wide card: the two buttons. Narrow card: one "..." menu with the same two actions. */}
            <span className="flex shrink-0 items-center gap-1 @max-lg:hidden">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => viewer.open(file)}
                >
                    {t('common.view')}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('file_card.download_title', {
                        title: file.title,
                    })}
                    onClick={() => downloadViewerFile(file)}
                >
                    <Download aria-hidden="true" />
                    {t('file_card.download')}
                </Button>
            </span>
            <span className="hidden shrink-0 @max-lg:block">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t('file_card.options_for_title', {
                                title: file.title,
                            })}
                        >
                            <MoreHorizontal aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => viewer.open(file)}>
                            <Eye aria-hidden="true" />
                            {t('common.view')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={() => downloadViewerFile(file)}
                        >
                            <Download aria-hidden="true" />
                            {t('file_card.download')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </span>
        </div>
    );
}
