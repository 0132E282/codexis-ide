import { t } from '@/lib/i18n';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { usePanelPlacement } from '@/hooks/use-panel-placement';
import { TAB_SIZES } from './use-editor-options';
import type { EditorOptions } from './use-editor-options';

/** * The editor's options menu (the button at the end of the tab bar): go to file, file tree, and the editor preferences. */
export function EditorOptionsMenu({
    options,
    onOptionChange,
    onQuickOpen,
    treeClosed,
    onTreeClosedChange,
    treePlacement,
    canCollapseAll,
    onCollapseAll,
}: {
    options: EditorOptions;
    onOptionChange: <Name extends keyof EditorOptions>(
        name: Name,
        value: EditorOptions[Name],
    ) => void;
    onQuickOpen: () => void;
    /** * Whether the host holds the tree's closed state (without it the tree item is not shown). */
    treeClosed?: boolean;
    onTreeClosedChange?: (closed: boolean) => void;
    treePlacement: ReturnType<typeof usePanelPlacement>;
    canCollapseAll: boolean;
    onCollapseAll: () => void;
}) {
    const checks: [keyof EditorOptions, string][] = [
        ['previewTabs', 'editor_options.preview_tabs'],
        ['autoSave', 'editor_options.auto_save'],
        ['tabKeyIndents', 'editor_options.tab_key_indents'],
    ];
    const views: [keyof EditorOptions, string][] = [
        ['wordWrap', 'editor_options.word_wrap'],
        ['indentGuides', 'editor_options.indent_guides'],
        ['showWhitespace', 'editor_options.show_whitespace'],
        ['scrollPastEnd', 'editor_options.scroll_past_end'],
    ];
    const placement = treePlacement.placement === 'left' ? 'left' : 'right';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('editor_options.title')}
                    title={t('editor_options.title')}
                    className="size-7 text-muted-foreground"
                >
                    <Settings2 aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
                <DropdownMenuItem onSelect={onQuickOpen}>
                    {t('editor_options.go_to_file')}
                    <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {onTreeClosedChange !== undefined && (
                    <DropdownMenuCheckboxItem
                        checked={treeClosed !== true}
                        onCheckedChange={(checked) =>
                            onTreeClosedChange(!checked)
                        }
                    >
                        {t('editor_options.show_tree')}
                        <DropdownMenuShortcut>⇧⌘Y</DropdownMenuShortcut>
                    </DropdownMenuCheckboxItem>
                )}
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        {t('editor_options.tree_position')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                            value={placement}
                            onValueChange={(value) =>
                                treePlacement.setPlacement(
                                    value === 'left' ? 'left' : 'right',
                                )
                            }
                        >
                            <DropdownMenuRadioItem value="left">
                                {t('editor_options.left')}
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="right">
                                {t('editor_options.right')}
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                    disabled={!canCollapseAll}
                    onSelect={onCollapseAll}
                >
                    {t('editor_options.collapse_all')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {checks.map(([name, label]) => (
                    <DropdownMenuCheckboxItem
                        key={name}
                        checked={options[name] === true}
                        onCheckedChange={(checked) =>
                            onOptionChange(name, checked as never)
                        }
                    >
                        {t(label)}
                    </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                {views.map(([name, label]) => (
                    <DropdownMenuCheckboxItem
                        key={name}
                        checked={options[name] === true}
                        onCheckedChange={(checked) =>
                            onOptionChange(name, checked as never)
                        }
                    >
                        {t(label)}
                    </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        {t('editor_options.tab_size')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                            value={String(options.tabSize)}
                            onValueChange={(value) =>
                                onOptionChange('tabSize', Number(value))
                            }
                        >
                            {TAB_SIZES.map((size) => (
                                <DropdownMenuRadioItem
                                    key={size}
                                    value={String(size)}
                                >
                                    {size}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
