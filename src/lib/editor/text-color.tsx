import type { Editor } from '@tiptap/react';
import { Baseline } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SWATCH_COLORS } from './constants';
import { t } from '@/lib/i18n';

/** * `color` lives on the shared `textStyle` mark registered by text-style.tsx. */
export function TextColorToolbar({ editor }: { editor: Editor }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 min-w-8 px-1.5"
                    title={t('text_color.text_color')}
                >
                    <Baseline
                        className="size-3.5"
                        style={{
                            color:
                                (editor.getAttributes('textStyle')
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
                                editor.chain().focus().setColor(color).run()
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
                                .setColor(event.target.value)
                                .run()
                        }
                        className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <button
                        type="button"
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() =>
                            editor.chain().focus().unsetColor().run()
                        }
                    >
                        {t('text_color.remove_text_color')}
                    </button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
