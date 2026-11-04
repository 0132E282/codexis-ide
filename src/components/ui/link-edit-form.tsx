import type { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

const REL_OPTIONS = [
    { key: 'nofollow', label: 'nofollow' },
    { key: 'noindex', label: 'noindex' },
    { key: 'noopener', label: 'noopener' },
    { key: 'noreferrer', label: 'noreferrer' },
    { key: 'sponsored', label: 'sponsored' },
    { key: 'ugc', label: 'ugc' },
] as const;

function parseRel(rel: string | null | undefined): Set<string> {
    return new Set((rel ?? '').split(/\s+/).filter(Boolean));
}

/** * Shared by LinkPopover (insert) and LinkBubbleMenu (edit): URL, `rel` (nofollow/noindex/noopener) and target. */
export function LinkEditForm({
    editor,
    onDone,
}: {
    editor: Editor;
    onDone: () => void;
}) {
    const [url, setUrl] = useState('');
    const [rel, setRel] = useState<Set<string>>(new Set());
    const [newTab, setNewTab] = useState(false);

    useEffect(() => {
        const attrs = editor.getAttributes('link');
        setUrl((attrs.href as string) ?? '');
        setRel(parseRel(attrs.rel as string | undefined));
        setNewTab(attrs.target === '_blank');
        // * Read only when the form mounts for a link, not on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggleRel = (key: string) => {
        setRel((current) => {
            const next = new Set(current);

            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }

            return next;
        });
    };

    const apply = () => {
        const editingExistingLink = editor.isActive('link');

        if (!url) {
            if (editingExistingLink) {
                editor
                    .chain()
                    .focus()
                    .extendMarkRange('link')
                    .unsetLink()
                    .run();
            }

            onDone();

            return;
        }

        // ! New links need selected text; `extendMarkRange` on an empty selection expanded onto surrounding text.
        if (!editingExistingLink && editor.state.selection.empty) {
            onDone();

            return;
        }

        const chain = editor.chain().focus();

        (editingExistingLink ? chain.extendMarkRange('link') : chain)
            .setLink({
                href: url,
                rel: [...rel].join(' ') || null,
                target: newTab ? '_blank' : null,
            })
            .run();

        onDone();
    };

    const remove = () => {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        onDone();
    };

    return (
        <div className="flex flex-col gap-3">
            <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://..."
                autoFocus
            />

            <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                        checked={newTab}
                        onCheckedChange={(checked) => setNewTab(!!checked)}
                    />
                    Mở tab mới (target="_blank")
                </label>
                {REL_OPTIONS.map(({ key, label }) => (
                    <label
                        key={key}
                        className="flex items-center gap-2 text-sm"
                    >
                        <Checkbox
                            checked={rel.has(key)}
                            onCheckedChange={() => toggleRel(key)}
                        />
                        rel="{label}"
                    </label>
                ))}
            </div>

            <div className="flex justify-end gap-2">
                {editor.isActive('link') && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={remove}
                    >
                        Xóa liên kết
                    </Button>
                )}
                <Button type="button" size="sm" onClick={apply}>
                    Áp dụng
                </Button>
            </div>
        </div>
    );
}
