import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Link as LinkIcon,
    StretchHorizontal,
    Type,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Toggle } from '@/components/ui/toggle';
import type { ImageAlign } from '@/lib/editor';
import { t } from '@/lib/i18n';

const ALIGN_OPTIONS: {
    value: ImageAlign;
    icon: typeof AlignLeft;
    label: string;
}[] = [
    {
        value: 'left',
        icon: AlignLeft,
        label: 'image_bubble_menu.left_wrap_text',
    },
    { value: 'center', icon: AlignCenter, label: 'image_bubble_menu.center' },
    {
        value: 'right',
        icon: AlignRight,
        label: 'image_bubble_menu.right_wrap_text',
    },
    {
        value: 'wide',
        icon: StretchHorizontal,
        label: 'image_bubble_menu.full_width',
    },
];

const WIDTHS = [
    { label: 'image_bubble_menu.original', value: '' },
    { label: '25%', value: '25%' },
    { label: '50%', value: '50%' },
    { label: '75%', value: '75%' },
    { label: '100%', value: '100%' },
];

// ! Module-level constants: BubbleMenu re-registers its plugin when these change by reference,
// ! which looped infinitely with RichTextEditor's re-render on every transaction.
const shouldShow = ({ editor }: { editor: Editor }) => editor.isActive('image');
// * Append to body: the default parent node clips the popup inside nested scroll containers.
const bubbleOptions = {
    strategy: 'fixed' as const,
    placement: 'top' as const,
    offset: 8,
    flip: true,
    shift: true,
    appendTo: () => document.body,
};

/** * Image toolbar: align, alt text, link and width (custom `Image` extension attributes). */
export function ImageBubbleMenu({ editor }: { editor: Editor }) {
    const [altOpen, setAltOpen] = useState(false);
    const [altText, setAltText] = useState('');
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');

    const attrs = editor.getAttributes('image');
    const updateAttrs = (next: Record<string, unknown>) =>
        editor.chain().focus().updateAttributes('image', next).run();

    return (
        <BubbleMenu
            editor={editor}
            pluginKey="imageBubbleMenu"
            shouldShow={shouldShow}
            options={bubbleOptions}
            className="bg-popover flex items-center gap-0.5 rounded-md border p-1 shadow-md"
        >
            {ALIGN_OPTIONS.map(({ value, icon: Icon, label }) => (
                <Toggle
                    key={value}
                    size="sm"
                    pressed={attrs.align === value}
                    onPressedChange={() => updateAttrs({ align: value })}
                    title={t(label)}
                >
                    <Icon className="size-3.5" />
                </Toggle>
            ))}

            <Popover
                open={altOpen}
                onOpenChange={(open) => {
                    setAltOpen(open);

                    if (open) {
                        setAltText((attrs.alt as string) ?? '');
                    }
                }}
            >
                <PopoverTrigger asChild>
                    <Toggle
                        size="sm"
                        pressed={altOpen}
                        title={t('image_bubble_menu.alt_text_alt')}
                    >
                        <Type className="size-3.5" />
                    </Toggle>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                    <Input
                        value={altText}
                        onChange={(event) => setAltText(event.target.value)}
                        placeholder={t(
                            'image_bubble_menu.image_description_for_seo',
                        )}
                        autoFocus
                    />
                    <Button
                        type="button"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={() => {
                            updateAttrs({ alt: altText });
                            setAltOpen(false);
                        }}
                    >
                        {t('common.save')}
                    </Button>
                </PopoverContent>
            </Popover>

            <Popover
                open={linkOpen}
                onOpenChange={(open) => {
                    setLinkOpen(open);

                    if (open) {
                        setLinkUrl((attrs.href as string) ?? '');
                    }
                }}
            >
                <PopoverTrigger asChild>
                    <Toggle
                        size="sm"
                        pressed={!!attrs.href}
                        title={t('image_bubble_menu.link_image_to_url')}
                    >
                        <LinkIcon className="size-3.5" />
                    </Toggle>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                    <Input
                        value={linkUrl}
                        onChange={(event) => setLinkUrl(event.target.value)}
                        placeholder="https://..."
                        autoFocus
                    />
                    <div className="mt-2 flex justify-end gap-2">
                        {attrs.href && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    updateAttrs({ href: null });
                                    setLinkOpen(false);
                                }}
                            >
                                {t('common.remove_link')}
                            </Button>
                        )}
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                updateAttrs({ href: linkUrl || null });
                                setLinkOpen(false);
                            }}
                        >
                            {t('common.apply')}
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>

            <select
                value={(attrs.width as string) ?? ''}
                onChange={(event) =>
                    updateAttrs({ width: event.target.value || null })
                }
                className="border-input h-8 rounded-md border bg-transparent px-1.5 text-xs"
                title={t('image_bubble_menu.size')}
            >
                {WIDTHS.map((width) => (
                    <option key={width.label} value={width.value}>
                        {width.label}
                    </option>
                ))}
            </select>
        </BubbleMenu>
    );
}
