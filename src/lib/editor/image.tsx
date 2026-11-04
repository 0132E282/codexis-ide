import { mergeAttributes } from '@tiptap/core';
import TiptapImage from '@tiptap/extension-image';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { FolderOpen, Image as ImagePlus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { FilePickerDialog } from '@/components/file-manager/file-picker-dialog';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export { ImageBubbleMenu } from '@/components/ui/image-bubble-menu';

export type ImageAlign = 'left' | 'center' | 'right' | 'wide';

const ALIGN_STYLE: Record<ImageAlign, string> = {
    left: 'float:left;margin:0.25rem 1rem 0.25rem 0',
    center: 'display:block;margin:0.5rem auto',
    right: 'float:right;margin:0.25rem 0 0.25rem 1rem',
    wide: 'display:block;width:100%;margin:0.5rem 0',
};

/** * Adds `align`, `width` and `href` (wraps `<img>` in `<a>`: atom nodes can't carry marks), edited by ImageBubbleMenu. */
export const Image = TiptapImage.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            align: { default: 'center' as ImageAlign },
            width: { default: null as string | null },
            href: { default: null as string | null },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'a[data-image-link] img[src]',
                getAttrs: (element) => {
                    const img = element as HTMLImageElement;
                    const link = img.closest('a');

                    return {
                        src: img.src,
                        alt: img.alt,
                        href: link?.href ?? null,
                    };
                },
            },
            { tag: 'img[src]' },
        ];
    },

    renderHTML({ HTMLAttributes }): DOMOutputSpec {
        const { align, width, href, ...rest } = HTMLAttributes;
        const style = [
            ALIGN_STYLE[(align as ImageAlign) ?? 'center'],
            width ? `width:${width}` : null,
        ]
            .filter(Boolean)
            .join(';');
        const img: DOMOutputSpec = ['img', mergeAttributes(rest, { style })];

        return href
            ? [
                  'a',
                  {
                      href,
                      'data-image-link': '',
                      target: '_blank',
                      rel: 'noopener',
                  },
                  img,
              ]
            : img;
    },
});

export function ImageToolbar({ editor }: { editor: Editor }) {
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [filePickerOpen, setFilePickerOpen] = useState(false);

    const insertImageUrl = (url: string) =>
        editor.chain().focus().setImage({ src: url }).run();

    // ! Local upload is an object URL that only lives in this tab; "Thư viện file" (FileController::picker) persists.
    const insertImageFromFile = (file: File) =>
        insertImageUrl(URL.createObjectURL(file));

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 min-w-8 px-1.5"
                        title="Chèn ảnh"
                    >
                        <ImagePlus className="size-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem
                        onClick={() => imageInputRef.current?.click()}
                    >
                        <Upload className="size-3.5" />
                        Tải lên từ hệ thống
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilePickerOpen(true)}>
                        <FolderOpen className="size-3.5" />
                        Thư viện file
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                        insertImageFromFile(file);
                    }

                    event.target.value = '';
                }}
            />
            <FilePickerDialog
                open={filePickerOpen}
                onOpenChange={setFilePickerOpen}
                multiple
                onPick={(urls) => urls.forEach(insertImageUrl)}
            />
        </>
    );
}
