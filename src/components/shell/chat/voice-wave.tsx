import { Square, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { voiceLevel } from '@/lib/voice-level';

const BAR_WIDTH = 4;
const BAR_GAP = 3;
const SAMPLES = 24;

/** The color of a design token as the canvas takes it. */
const primaryColor = (canvas: HTMLCanvasElement) =>
    getComputedStyle(canvas).getPropertyValue('--primary').trim() || '#2f6fed';

/** Draws round vertical bars across the whole canvas, taller with the voice. At rest they are low but clear and breathe a little. Measures the canvas itself (and again when it is resized), and stops drawing while the page is hidden; with reduced motion one still frame is drawn. */
function startDrawing(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');

    if (context === null) {
        return () => undefined;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let frame = 0;
    let ticks = 0;
    let last = 0;
    let color = primaryColor(canvas);
    let heights: number[] = [];

    const measure = () => {
        const ratio = window.devicePixelRatio || 1;

        width = canvas.clientWidth;
        height = canvas.clientHeight;
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        heights = [];
    };
    const render = (now: number, animate: boolean) => {
        const count = Math.max(
            1,
            Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)),
        );
        const samples = animate
            ? voiceLevel.readBands(now, SAMPLES)
            : Array.from({ length: SAMPLES }, () => 0);
        const used = count * BAR_WIDTH + (count - 1) * BAR_GAP;
        const left = (width - used) / 2;
        const lowest = Math.min(5, height * 0.4);
        const tallest = height - 2;

        context.clearRect(0, 0, width, height);
        context.fillStyle = color;

        for (let index = 0; index < count; index++) {
            const sample = samples[Math.floor((index / count) * SAMPLES)] ?? 0;
            const breath = animate ? Math.sin(now / 900 + index * 0.45) : 0;
            const target = lowest + breath * 1.2 + sample * (tallest - lowest);
            const previous = heights[index] ?? lowest;
            const barHeight = Math.min(
                tallest,
                Math.max(lowest, previous + (target - previous) * 0.35),
            );

            heights[index] = barHeight;
            context.globalAlpha = 0.55 + 0.45 * Math.min(1, sample * 1.5);
            context.beginPath();
            context.roundRect(
                left + index * (BAR_WIDTH + BAR_GAP),
                (height - barHeight) / 2,
                BAR_WIDTH,
                barHeight,
                BAR_WIDTH / 2,
            );
            context.fill();
        }
    };
    const draw = (now: number) => {
        const quiet = !voiceLevel.isSpeaking() && !voiceLevel.isListening();

        // * At rest a few frames per second are enough for the breathing.
        if (quiet && now - last < 60) {
            frame = requestAnimationFrame(draw);

            return;
        }

        last = now;

        if (ticks++ % 120 === 0) {
            color = primaryColor(canvas);
        }

        render(now, true);
        frame = requestAnimationFrame(draw);
    };
    const run = () => {
        cancelAnimationFrame(frame);

        if (reduced.matches) {
            render(0, false);
        } else if (!document.hidden) {
            frame = requestAnimationFrame(draw);
        }
    };
    const observer = new ResizeObserver(() => {
        measure();
        run();
    });

    measure();
    observer.observe(canvas);
    document.addEventListener('visibilitychange', run);
    reduced.addEventListener('change', run);
    run();

    return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener('visibilitychange', run);
        reduced.removeEventListener('change', run);
    };
}

/** Popup above the message box while listening (dictation) or reading aloud: a label, a close button and bars that jump with the voice across the whole width. Shown only for those moments, so it does not push the layout. */
export function VoicePopup({
    label,
    failed,
    reading,
    onClose,
}: {
    label: string;
    /** The label is a warning (listening failed). */
    failed: boolean;
    /** The AI is reading aloud (the popup then has a clear Stop button). */
    reading: boolean;
    onClose: () => void;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const element = canvas.current;

        return element === null ? undefined : startDrawing(element);
    }, []);

    return (
        <div
            data-testid="voice-popup"
            role="status"
            className="absolute right-0 bottom-full left-0 z-20 mb-2 animate-in rounded-lg border bg-popover p-3 text-popover-foreground shadow-md duration-150 fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
        >
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                {!failed && (
                    <span
                        aria-hidden="true"
                        className="size-2 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none"
                    />
                )}
                <span className={cn(failed && 'text-amber-500')}>{label}</span>
                {reading && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
                    >
                        <Square aria-hidden="true" className="size-3" />
                        {t('composer.stop_reading')}
                    </button>
                )}
                <button
                    type="button"
                    aria-label={t('voice_transcript.close')}
                    title={t('voice_transcript.close')}
                    onClick={onClose}
                    className={cn(
                        'rounded p-0.5 hover:bg-muted',
                        !reading && 'ml-auto',
                    )}
                >
                    <X aria-hidden="true" className="size-3.5" />
                </button>
            </div>
            <canvas
                ref={canvas}
                aria-hidden="true"
                className="block h-10 w-full"
            />
        </div>
    );
}
