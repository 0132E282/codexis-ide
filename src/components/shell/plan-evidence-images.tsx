import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import { mediaMime, readMedia } from '@/lib/media-file';
import { cn } from '@/lib/utils';

type EvidenceGroup = 'before' | 'after' | 'other';
const EVIDENCE_GROUPS: EvidenceGroup[] = ['before', 'after', 'other'];
const GROUP_TEXT = {
    before: 'plans.evidence_before',
    after: 'plans.evidence_after',
    other: 'plans.evidence_other',
} as const;

/** Which side of a change a picture shows, from its file name (`before`/`truoc` or `after`/`sau` as a word of the name). */
function evidenceGroup(path: string): EvidenceGroup {
    const name = path.split('/').pop() ?? path;

    if (/(^|[-_.])(before|truoc)([-_.]|$)/i.test(name)) {
        return 'before';
    }

    return /(^|[-_.])(after|sau)([-_.]|$)/i.test(name) ? 'after' : 'other';
}

const IMAGE_PATH = /[\w./-]+\.(?:png|jpe?g|gif|webp)\b/gi;

/** The picture paths written in a text (a plan's `result` or criterion note), each once. */
export function imagePaths(text: string | null): string[] {
    return text === null ? [] : [...new Set(text.match(IMAGE_PATH) ?? [])];
}

/** `text` without the paths of the pictures that are shown, and without the empty brackets and commas they leave behind. */
function withoutShownPaths(text: string, shown: string[]): string {
    return shown
        .reduce((rest, path) => rest.split(path).join(''), text)
        .replace(/\(\s*[,;\s]*\)/g, '')
        .replace(/\s+([,;.])/g, '$1')
        .replace(/([,;])\s*(?=[,;])/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/** A plan's `result` or criterion note: the pictures it names are read from the project and embedded as small thumbnails under the text (the text keeps the path of a picture that cannot be read). */
export function PlanEvidenceText({
    root,
    text,
    variant = 'thumbnails',
}: {
    root: string | undefined;
    text: string;
    /** `thumbnails`: small pictures side by side; `slides`: one large picture with previous and next buttons. */
    variant?: 'thumbnails' | 'slides';
}) {
    const paths = imagePaths(text);
    const [sources, setSources] = useState<Record<string, string>>({});
    const [opened, setOpened] = useState<string | null>(null);
    const [slide, setSlide] = useState(0);
    const [group, setGroup] = useState<EvidenceGroup>('before');
    // * Which way the slide moved last: the next picture comes in from that side.
    const [direction, setDirection] = useState<1 | -1>(1);
    const key = paths.join('\n');

    useEffect(() => {
        let isCurrent = true;

        for (const path of key === '' ? [] : key.split('\n')) {
            const mime = mediaMime(path);

            if (mime === null) {
                continue;
            }

            readMedia(path, mime, root)
                .then((source) => {
                    if (isCurrent) {
                        setSources((current) => ({
                            ...current,
                            [path]: source,
                        }));
                    }
                })
                // * A picture that is missing or not readable is just not shown; the path stays in the text.
                .catch(() => undefined);
        }

        return () => {
            isCurrent = false;
        };
    }, [key, root]);

    const shown = paths.filter((path) => sources[path] !== undefined);

    if (shown.length === 0) {
        return <>{text}</>;
    }

    // * The slides split into "before" and "after" the change when the names say so (`<task>-before.png`, `<task>-after.png`); each tab steps through its own pictures.
    const groups = EVIDENCE_GROUPS.filter((name) =>
        shown.some((path) => evidenceGroup(path) === name),
    );
    const isSplit = variant === 'slides' && groups.length > 1;
    const activeGroup = groups.includes(group) ? group : groups[0];
    const list = isSplit
        ? shown.filter((path) => evidenceGroup(path) === activeGroup)
        : shown;

    // * The slide and the zoomed picture both step through the list pictures, wrapping around at the ends.
    const step = (from: string | number, by: number) =>
        ((typeof from === 'number' ? from : list.indexOf(from)) +
            by +
            list.length) %
        list.length;
    const onArrow = (event: KeyboardEvent, move: (by: number) => void) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            move(event.key === 'ArrowLeft' ? -1 : 1);
        }
    };
    const current = list[Math.min(slide, list.length - 1)];
    const goSlide = (by: 1 | -1) => {
        setDirection(by);
        setSlide(step(list.indexOf(current), by));
    };

    return (
        <>
            {withoutShownPaths(text, shown)}
            {isSplit && (
                <div role="tablist" className="mt-2 flex gap-1">
                    {groups.map((name) => (
                        <Button
                            key={name}
                            type="button"
                            role="tab"
                            aria-selected={name === activeGroup}
                            variant={
                                name === activeGroup ? 'default' : 'outline'
                            }
                            size="sm"
                            onClick={() => {
                                setGroup(name);
                                setSlide(0);
                            }}
                        >
                            {t(GROUP_TEXT[name])}
                        </Button>
                    ))}
                </div>
            )}
            {variant === 'slides' ? (
                <div
                    tabIndex={0}
                    onKeyDown={(event) =>
                        onArrow(event, (by) => goSlide(by === 1 ? 1 : -1))
                    }
                    className="relative mt-2 flex items-center justify-center overflow-hidden rounded-md border bg-muted/40 p-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    <button
                        // * A new key remounts the picture, which plays the slide-in.
                        key={current}
                        type="button"
                        title={current}
                        onClick={() => setOpened(current)}
                        className={cn(
                            'animate-in fade-in-0 block cursor-zoom-in duration-300 motion-reduce:animate-none',
                            direction === 1
                                ? 'slide-in-from-right-12'
                                : 'slide-in-from-left-12',
                        )}
                    >
                        <img
                            src={sources[current]}
                            alt={current}
                            className="max-h-[45vh] max-w-full rounded object-contain"
                        />
                    </button>
                    {list.length > 1 && (
                        <>
                            <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                aria-label="‹"
                                onClick={() => goSlide(-1)}
                                className="absolute top-1/2 left-2 -translate-y-1/2"
                            >
                                <ChevronLeft aria-hidden="true" />
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                aria-label="›"
                                onClick={() => goSlide(1)}
                                className="absolute top-1/2 right-2 -translate-y-1/2"
                            >
                                <ChevronRight aria-hidden="true" />
                            </Button>
                            <span className="absolute right-3 bottom-3 rounded bg-background/80 px-1.5 text-[11px]">
                                {list.indexOf(current) + 1}/{list.length}
                            </span>
                        </>
                    )}
                </div>
            ) : (
                <div className="mt-1.5 flex flex-wrap gap-2">
                    {shown.map((path) => (
                        <button
                            key={path}
                            type="button"
                            title={path}
                            onClick={() => setOpened(path)}
                            className="block cursor-zoom-in rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                            <img
                                src={sources[path]}
                                alt={path}
                                className="h-16 w-auto max-w-40 rounded border object-cover object-top"
                            />
                        </button>
                    ))}
                </div>
            )}
            <Dialog
                open={opened !== null}
                onOpenChange={(isOpen) => !isOpen && setOpened(null)}
            >
                <DialogContent
                    onKeyDown={(event) =>
                        opened !== null &&
                        onArrow(event, (by) =>
                            setOpened(list[step(opened, by)]),
                        )
                    }
                    className="max-h-[95vh] w-auto max-w-[95vw] overflow-auto sm:max-w-[95vw]"
                >
                    <DialogTitle className="font-mono text-xs break-all">
                        {opened}
                    </DialogTitle>
                    {opened !== null && sources[opened] !== undefined && (
                        <img
                            src={sources[opened]}
                            alt={opened}
                            className="max-h-[80vh] max-w-full object-contain"
                        />
                    )}
                    {opened !== null && list.length > 1 && (
                        <div className="flex justify-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="‹"
                                onClick={() =>
                                    setOpened(list[step(opened, -1)])
                                }
                            >
                                <ChevronLeft aria-hidden="true" />
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="›"
                                onClick={() => setOpened(list[step(opened, 1)])}
                            >
                                <ChevronRight aria-hidden="true" />
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
