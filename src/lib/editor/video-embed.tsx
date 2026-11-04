import { mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { Video } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        videoEmbed: {
            setVideoEmbed: (src: string) => ReturnType;
        };
    }
}

const PROVIDER_PATTERNS: {
    test: RegExp;
    toEmbedUrl: (match: RegExpMatchArray) => string;
}[] = [
    {
        test: /(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([\w-]+)/,
        toEmbedUrl: (m) => `https://www.youtube.com/embed/${m[1]}`,
    },
    {
        test: /vimeo\.com\/(\d+)/,
        toEmbedUrl: (m) => `https://player.vimeo.com/video/${m[1]}`,
    },
];

/** * Rewrites YouTube/Vimeo watch links to embed URLs; others pass through. */
export function toEmbedUrl(url: string): string {
    for (const provider of PROVIDER_PATTERNS) {
        const match = url.match(provider.test);

        if (match) {
            return provider.toEmbedUrl(match);
        }
    }

    return url;
}

/** * Iframe embeds only; uploaded video files would need a `<video>` node. */
export const VideoEmbed = Node.create({
    name: 'videoEmbed',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            src: { default: null },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-video-embed] iframe',
                getAttrs: (element) => ({
                    src: (element as HTMLIFrameElement).src,
                }),
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'div',
            {
                'data-video-embed': '',
                style: 'position:relative;padding-top:56.25%',
            },
            [
                'iframe',
                mergeAttributes(HTMLAttributes, {
                    src: HTMLAttributes.src,
                    style: 'position:absolute;top:0;left:0;width:100%;height:100%;border:0',
                    allowfullscreen: 'true',
                }),
            ],
        ];
    },

    addCommands() {
        return {
            setVideoEmbed:
                (src: string) =>
                ({ commands }) =>
                    commands.insertContent({
                        type: this.name,
                        attrs: { src: toEmbedUrl(src) },
                    }),
        };
    },
});

export function VideoToolbar({ editor }: { editor: Editor }) {
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState('');

    const insert = () => {
        if (url) {
            editor.chain().focus().setVideoEmbed(url).run();
        }

        setUrl('');
        setOpen(false);
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);

                if (!next) {
                    setUrl('');
                }
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 min-w-8 px-1.5"
                    title="Chèn video"
                >
                    <Video className="size-3.5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
                <div className="flex flex-col gap-3">
                    <Input
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="URL video (YouTube, Vimeo, ...)"
                        autoFocus
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                insert();
                            }
                        }}
                    />
                    <div className="flex justify-end">
                        <Button type="button" size="sm" onClick={insert}>
                            Chèn
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
