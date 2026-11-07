// * The loudness of the voice that is being read aloud, for the voice effect.
// * VieNeu audio goes through a Web Audio analyser (a real level). The webview's speech synthesis has no audio stream, so its level is simulated: each word boundary gives a pulse that dies away, on top of a light movement while it speaks.

type Mode = 'audio' | 'simulated';

const listeners = new Set<() => void>();
let speaking = false;
let mode: Mode = 'simulated';
let pulseLevel = 0;
let pulseTime = 0;
let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let frequencies: Uint8Array<ArrayBuffer> | null = null;
// * `createMediaElementSource` may be called once per element.
const sources = new WeakSet<HTMLAudioElement>();
// * The microphone while dictating: its own stream and analyser (null: none, then the level is simulated).
let listening = false;
let micStream: MediaStream | null = null;
let micContext: AudioContext | null = null;
let micAnalyser: AnalyserNode | null = null;
let micFrequencies: Uint8Array<ArrayBuffer> | null = null;

let version = 0;
const notify = () => {
    version++;
    listeners.forEach((listener) => listener());
};

/** Closes the audio context (it is made again when needed): nothing is drawn or processed any more. */
export function closeAudio(): void {
    const closing = context;

    context = null;
    analyser = null;
    frequencies = null;
    speaking = false;
    notify();

    if (closing !== null) {
        void closing.close().catch(() => undefined);
    }
}

/** Creates the audio context, which must happen in or after a user gesture to be allowed to run; safe to call again. */
export function prepareAudio(): void {
    try {
        context ??= new AudioContext();

        if (context.state === 'suspended') {
            void context.resume().catch(() => undefined);
        }
    } catch {
        context = null;
    }
}

/** Routes `audio` through the analyser (once per element); false when Web Audio is not available, and then the audio plays plain. */
export function attachAudio(audio: HTMLAudioElement): boolean {
    prepareAudio();

    if (context === null) {
        return false;
    }

    if (sources.has(audio)) {
        return analyser !== null;
    }

    try {
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        frequencies = new Uint8Array(analyser.frequencyBinCount);
        context.createMediaElementSource(audio).connect(analyser);
        analyser.connect(context.destination);
        sources.add(audio);

        return true;
    } catch {
        analyser = null;

        return false;
    }
}

/** Mean of the low half of an analyser's spectrum (0..1) and its bands. */
function measure(
    node: AnalyserNode,
    data: Uint8Array<ArrayBuffer>,
    count: number,
): { level: number; bands: number[] } {
    node.getByteFrequencyData(data);

    const half = Math.floor(data.length / 2);
    let sum = 0;

    for (let index = 0; index < half; index++) {
        sum += data[index];
    }

    const usable = Math.floor(data.length * 0.6);
    const size = Math.max(1, Math.floor(usable / count));
    const bands = Array.from({ length: count }, (_, band) => {
        let total = 0;

        for (let index = 0; index < size; index++) {
            total += data[band * size + index] ?? 0;
        }

        return Math.min(1, (total / size / 255) * 1.6);
    });

    return { level: Math.min(1, (sum / half / 255) * 1.8), bands };
}

/** Starts or stops following the microphone (dictation). Without the permission the level is simulated instead. */
export async function followMicrophone(on: boolean): Promise<void> {
    listening = on;
    notify();

    if (!on) {
        micStream?.getTracks().forEach((track) => track.stop());
        micStream = null;
        micAnalyser = null;
        micFrequencies = null;

        const closing = micContext;

        micContext = null;

        if (closing !== null) {
            void closing.close().catch(() => undefined);
        }

        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });

        if (!listening) {
            stream.getTracks().forEach((track) => track.stop());

            return;
        }

        micStream = stream;
        micContext = new AudioContext();
        micAnalyser = micContext.createAnalyser();
        micAnalyser.fftSize = 256;
        micAnalyser.smoothingTimeConstant = 0.7;
        micFrequencies = new Uint8Array(micAnalyser.frequencyBinCount);
        micContext.createMediaStreamSource(stream).connect(micAnalyser);
    } catch {
        micAnalyser = null;
    }
}

export const voiceLevel = {
    subscribe(listener: () => void) {
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    },
    isSpeaking: () => speaking,
    isListening: () => listening,
    /** Changes whenever a run starts, stops or ends. */
    version: () => version,
    /** Tells the listeners that a run started, stopped or ended. */
    bump: notify,
    /** `source`: where the level comes from while speaking. */
    setSpeaking(next: boolean, source: Mode = 'simulated') {
        mode = source;

        if (!next) {
            pulseLevel = 0;
        }

        if (speaking !== next) {
            speaking = next;
            notify();
        }
    },
    /** A word boundary of the simulated voice. */
    pulse(strength = 1) {
        pulseLevel = Math.min(1, Math.max(pulseLevel, 0.5 + 0.5 * strength));
        pulseTime = performance.now();
    },
    /** Loudness 0..1 right now (0: silent). */
    read(now: number): number {
        if (listening) {
            return micAnalyser !== null && micFrequencies !== null
                ? measure(micAnalyser, micFrequencies, 1).level
                : 0.2 + 0.15 * Math.sin(now / 120) * Math.sin(now / 330);
        }

        if (!speaking) {
            return 0;
        }

        if (mode === 'audio' && analyser !== null && frequencies !== null) {
            analyser.getByteFrequencyData(frequencies);

            // * The voice lives in the low half of the spectrum.
            const count = Math.floor(frequencies.length / 2);
            let sum = 0;

            for (let index = 0; index < count; index++) {
                sum += frequencies[index];
            }

            return Math.min(1, (sum / count / 255) * 1.8);
        }

        const decay = Math.exp(-(now - pulseTime) / 180);

        return Math.min(
            1,
            0.18 + 0.08 * Math.sin(now / 140) + pulseLevel * decay * 0.7,
        );
    },
    /** `count` band levels 0..1 (bars of the effect). */
    readBands(now: number, count: number): number[] {
        if (listening && micAnalyser !== null && micFrequencies !== null) {
            return measure(micAnalyser, micFrequencies, count).bands;
        }

        if (!speaking && !listening) {
            return Array.from({ length: count }, () => 0);
        }

        if (mode === 'audio' && analyser !== null && frequencies !== null) {
            analyser.getByteFrequencyData(frequencies);

            const usable = Math.floor(frequencies.length * 0.6);
            const size = Math.max(1, Math.floor(usable / count));

            return Array.from({ length: count }, (_, band) => {
                let sum = 0;

                for (let index = 0; index < size; index++) {
                    sum += frequencies?.[band * size + index] ?? 0;
                }

                return Math.min(1, (sum / size / 255) * 1.6);
            });
        }

        const level = voiceLevel.read(now);

        return Array.from({ length: count }, (_, band) =>
            Math.min(
                1,
                level * (0.55 + 0.45 * Math.sin(now / 90 + band * 1.7) ** 2),
            ),
        );
    },
};
