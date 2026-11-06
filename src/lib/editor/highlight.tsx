import HighlightExtension from '@tiptap/extension-highlight';
import type { Editor } from '@tiptap/react';
import { Highlighter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SWATCH_COLORS } from './constants';
import { t } from '@/lib/i18n';

export const Highlight = HighlightExtension.configure({ multicolor: true });

export function HighlightToolbar({ editor }: { editor: Editor }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 min-w-8 px-1.5"
                    title={t('highlight.highlight_color')}
                >
                    <Highlighter
                        className="size-3.5"
                        style={{
                            color:
                                (editor.getAttributes('highlight')
                                    .color as string) || undefined,
                        }}
                    />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto p-2">
                <div className="grid grid-cols-8 gap-1">
                    {SWATCH_COLORS.map((color) => (
                        <button
                            key={color}
                            type="button"
                            style={{ backgroundColor: color }}
                            className="size-5 rounded-full ring-1 ring-black/10 ring-inset"
                            onClick={() =>
                                editor
                                    .chain()
                                    .focus()
                                    .toggleHighlight({ color })
                                    .run()
                            }
                        />
                    ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <input
                        type="color"
                        onChange={(event) =>
                            editor
                                .chain()
                                .focus()
                                .setHighlight({ color: event.target.value })
                                .run()
                        }
                        className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <button
                        type="button"
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() =>
                            editor.chain().focus().unsetHighlight().run()
                        }
                    >
                        {t('highlight.remove_highlight')}
                    </button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
