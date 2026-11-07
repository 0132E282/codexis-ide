import {
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { toast } from 'sonner';
import { getLanguage, t } from '@/lib/i18n';
import { ideSettings, SETTINGS_SAVED_EVENT } from '@/lib/ide-settings';
import type { ChatSettings } from '@/lib/ide-settings';
import { ideSpeech } from '@/lib/ide-speech';
import {
    attachAudio,
    closeAudio,
    prepareAudio,
    voiceLevel,
} from '@/lib/voice-level';

/** The answer as plain sentences to listen to: code blocks become a short remark, links a word, tables, markdown signs and decoration are left out. */
export function toSpokenText(markdown: string): string {
    return markdown
        .replace(/```[\s\S]*?```/g, ` ${t('composer.spoken_code')} `)
        .replace(/^\s*\|.*\|\s*$/gm, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\bhttps?:\/\/\S+/g, t('composer.spoken_link'))
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/^\s*([-=_*])\1{2,}\s*$/gm, ' ')
        .replace(/[*_~|#>•→←↔✓✗✔✘★☆]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const VIETNAMESE_MARKS =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const FALLBACK_LANGUAGES = { vi: 'vi-VN', en: 'en-US' } as const;

/** Language of a piece of text from its characters: Vietnamese marks, Kana, Hangul, Thai, Han, else Latin; null when there are too few letters to tell. */
export function detectLanguage(text: string): string | null {
    if (/[぀-ヿ]/.test(text)) {
        return 'ja-JP';
    }

    if (/[가-힯]/.test(text)) {
        return 'ko-KR';
    }

    if (/[฀-๿]/.test(text)) {
        return 'th-TH';
    }

    if (/[一-鿿]/.test(text)) {
        return 'zh-CN';
    }

    if (VIETNAMESE_MARKS.test(text)) {
        return 'vi-VN';
    }

    return (text.match(/[a-z]/gi) ?? []).length >= 3 ? 'en-US' : null;
}

/** The text cut into runs of one language, in order: sentences and lines are tagged, and neighbours of the same language are joined. A piece with too few letters joins the run before it (or the interface language when it comes first). */
export function splitByLanguage(
    text: string,
): { lang: string; text: string }[] {
    const fallback = FALLBACK_LANGUAGES[getLanguage()];
    const runs: { lang: string; text: string }[] = [];

    for (const piece of text.split(/(?<=[.!?。！？])\s+|\n+/)) {
        const trimmed = piece.trim();

        if (trimmed === '') {
            continue;
        }

        const lang = detectLanguage(trimmed) ?? runs.at(-1)?.lang ?? fallback;
        const last = runs.at(-1);

        if (last !== undefined && last.lang === lang) {
            last.text += ` ${trimmed}`;
        } else {
            runs.push({ lang, text: trimmed });
        }
    }

    return runs;
}

const sameLanguage = (voice: SpeechSynthesisVoice, lang: string) =>
    voice.lang.replace('_', '-').toLowerCase().split('-')[0] ===
    lang.toLowerCase().split('-')[0];

// * Old synthesized voices that sound like machines: never picked on their own.
const ROBOTIC_VOICE =
    /fred|zarvox|trinoids|bad news|bubbles|cellos|boing|whisper|bells|organ|good news|jester|albert|junior|ralph|kathy|superstar|deranged|hysterical|wobble/i;
const QUALITY_VOICE = /enhanced|premium|siri|natural/i;

/** How pleasant a voice is likely to be: natural-quality names, the northern Vietnamese "Linh", device voices; machine-like voices last. */
function voiceScore(voice: SpeechSynthesisVoice, lang: string): number {
    return (
        (QUALITY_VOICE.test(voice.name) ? 3 : 0) +
        (lang.startsWith('vi') && /linh/i.test(voice.name) ? 4 : 0) +
        (voice.localService ? 1 : 0) -
        (ROBOTIC_VOICE.test(voice.name) ? 5 : 0)
    );
}

/** The voice for `lang`: the one chosen in the settings when it speaks that language, else the most natural installed one (same region first, then by `voiceScore`); undefined lets the system choose from `utterance.lang`. */
export function chooseVoice(
    voices: SpeechSynthesisVoice[],
    lang: string,
    preferredName: string,
): SpeechSynthesisVoice | undefined {
    const preferred = voices.find((voice) => voice.name === preferredName);

    if (preferred !== undefined && sameLanguage(preferred, lang)) {
        return preferred;
    }

    const exact = (voice: SpeechSynthesisVoice) =>
        voice.lang.replace('_', '-').toLowerCase() === lang.toLowerCase();

    return voices
        .filter((voice) => sameLanguage(voice, lang))
        .sort(
            (a, b) =>
                Number(exact(b)) - Number(exact(a)) ||
                voiceScore(b, lang) - voiceScore(a, lang),
        )[0];
}

// * WebKit drops an utterance that nothing references before it finishes (it then goes silent and never calls onend), so the one being spoken is kept here.
let current: SpeechSynthesisUtterance | null = null;
// * Raised by every stop, so a run that is still starting (or between two utterances) does not go on speaking.
let generation = 0;
// * WebKit stops long utterances after a while: each piece is at most this long.
const MAX_PIECE_LENGTH = 200;

/** `text` cut at sentence ends and spaces into pieces of at most `MAX_PIECE_LENGTH` characters. */
export function splitIntoPieces(text: string): string[] {
    const pieces: string[] = [];
    let rest = text.trim();

    while (rest.length > MAX_PIECE_LENGTH) {
        const window = rest.slice(0, MAX_PIECE_LENGTH);
        const cut = Math.max(
            window.lastIndexOf('. '),
            window.lastIndexOf('! '),
            window.lastIndexOf('? '),
            window.lastIndexOf(', '),
            window.lastIndexOf(' '),
        );
        const end = cut > 0 ? cut + 1 : MAX_PIECE_LENGTH;

        pieces.push(rest.slice(0, end).trim());
        rest = rest.slice(end).trim();
    }

    if (rest !== '') {
        pieces.push(rest);
    }

    return pieces;
}

// * The one element VieNeu audio plays through (a media element gets one Web Audio source for good), and what the running run holds to be released when it stops.
let player: HTMLAudioElement | null = null;
let releaseRun: (() => void) | null = null;

/** The number of the run that is current: a run is over when this no longer is its number. */
export const currentRun = () => generation;

/** A VieNeu-TTS server to read Vietnamese with. */
export type VieneuEngine = { url: string; voice: string };

/** How an answer is read: the VieNeu-TTS server for Vietnamese (null: system voices only) and the speed in percent. */
export type ReadingOptions = {
    vieneu: VieneuEngine | null;
    ratePercent: number;
};

// * A soft delivery: a little slower than the default, the pitch left alone, a short silence between pieces.
const BASE_RATE = 0.95;
const BASE_PITCH = 1.02;
const PAUSE_AFTER_SENTENCE_MS = 220;
const PAUSE_AFTER_PIECE_MS = 130;

/** The WAV bytes of a base64 string as an audio blob. */
function wavBlob(base64: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: 'audio/wav' });
}

/** Stops whatever is being read and any run that has not started speaking yet. */
export function stopSpeaking() {
    generation++;
    current = null;
    releaseRun?.();
    releaseRun = null;

    if (player !== null) {
        player.onplaying = null;
        player.onended = null;
        player.onerror = null;
        player.pause();
        player.removeAttribute('src');
    }

    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    voiceLevel.setSpeaking(false);
    voiceLevel.bump();
}

/** Stops reading and lets go of the audio machinery (the audio context closes; the next reading makes a new one). */
export function shutdownSpeech() {
    stopSpeaking();
    player = null;
    closeAudio();
}

/** Reads `text` aloud, one utterance after the other (one per piece of a run of one language), each in a voice that speaks it. Starts synchronously, so it runs inside the click that asked for it. `onEnd` gets an error message when the speech failed. */
export function speakAloud(
    text: string,
    voices: SpeechSynthesisVoice[],
    preferredVoice: string,
    options: ReadingOptions,
    handlers: {
        onStart: () => void;
        /** VieNeu-TTS failed (the reason is translated): the rest of the run is read by the system voice. */
        onVieneuFailed: (reason: string) => void;
        onEnd: (failure: string | null) => void;
        /** No installed voice speaks this language (called once per language); the default voice reads it instead. */
        onMissingVoice: (lang: string) => void;
    },
): number | null {
    const queue = splitByLanguage(toSpokenText(text)).flatMap((run) =>
        splitIntoPieces(run.text).map((piece) => ({
            text: piece,
            lang: run.lang,
        })),
    );
    stopSpeaking();

    const { vieneu, ratePercent } = options;
    const own = generation;
    const missing = new Set<string>();
    let started = false;
    let vieneuFailed = false;
    const prefetched = new Map<number, Promise<string>>();
    const blobUrls = new Set<string>();
    const markStarted = () => {
        if (!started) {
            started = true;
            handlers.onStart();
        }
    };
    const finish = (failure: string | null) => {
        voiceLevel.setSpeaking(false);
        voiceLevel.bump();
        handlers.onEnd(failure);
    };

    if (queue.length === 0) {
        handlers.onEnd(null);

        return null;
    }

    // * A paused queue (left by an earlier run) stays silent until it is resumed.
    if ('speechSynthesis' in window) {
        window.speechSynthesis.resume();
    }

    if (vieneu !== null) {
        // * Inside the click, so the audio context is allowed to run.
        prepareAudio();
    }

    releaseRun = () => {
        blobUrls.forEach((url) => URL.revokeObjectURL(url));
        blobUrls.clear();
        prefetched.clear();
    };

    const usesVieneu = (index: number) =>
        vieneu !== null && !vieneuFailed && queue[index]?.lang === 'vi-VN';
    const fetchPiece = (index: number): Promise<string> => {
        const known = prefetched.get(index);

        if (known !== undefined) {
            return known;
        }

        const pending = ideSpeech
            .synthesize(
                vieneu?.url ?? '',
                vieneu?.voice ?? '',
                queue[index].text,
            )
            .then((reply) => {
                if (own !== generation) {
                    return '';
                }

                const url = URL.createObjectURL(wavBlob(reply.wavBase64));

                blobUrls.add(url);

                return url;
            });

        prefetched.set(index, pending);
        // * A prefetch nobody waits for yet must not be an unhandled rejection.
        pending.catch(() => undefined);

        return pending;
    };
    const playVieneu = (index: number) => {
        const fallBack = (reason: string) => {
            if (own !== generation) {
                return;
            }

            vieneuFailed = true;
            handlers.onVieneuFailed(reason);
            speakNext(index);
        };

        fetchPiece(index)
            .then((url) => {
                if (own !== generation || url === '') {
                    return;
                }

                player ??= new Audio();

                const audio = player;

                attachAudio(audio);
                audio.onplaying = () => {
                    markStarted();
                    voiceLevel.setSpeaking(true, 'audio');
                    voiceLevel.bump();
                };
                audio.onended = () => {
                    URL.revokeObjectURL(url);
                    blobUrls.delete(url);
                    prefetched.delete(index);
                    speakNext(index + 1);
                };
                audio.onerror = () => fallBack('audio');
                audio.src = url;

                // * Fetch the next piece while this one plays.
                if (usesVieneu(index + 1)) {
                    void fetchPiece(index + 1);
                }

                return audio.play().catch(() => fallBack('audio'));
            })
            .catch((caught: unknown) =>
                fallBack(
                    caught instanceof Error ? caught.message : String(caught),
                ),
            );
    };

    const speakNext = (index: number) => {
        if (own !== generation) {
            return;
        }

        if (index >= queue.length) {
            current = null;
            finish(null);

            return;
        }

        if (usesVieneu(index)) {
            playVieneu(index);

            return;
        }

        const item = queue[index];
        const utterance = new SpeechSynthesisUtterance(item.text);

        utterance.rate = BASE_RATE * (ratePercent / 100);
        utterance.pitch = BASE_PITCH;
        utterance.volume = 1;
        const voice = chooseVoice(voices, item.lang, preferredVoice);

        if (voice !== undefined) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else if (voices.length === 0) {
            // * The list has not loaded: the language alone lets the system pick.
            utterance.lang = item.lang;
        }
        // * With voices installed but none for this language the utterance keeps the system's default voice and no `lang`: some sound (a poor accent) beats the silence WebKit gives for a language it has no voice for.
        if (
            voice === undefined &&
            voices.length > 0 &&
            !missing.has(item.lang)
        ) {
            if (missing.size === 0) {
                console.warn(
                    `No voice for ${item.lang}. Installed voices:`,
                    voices.map(
                        (candidate) =>
                            `${candidate.name} (${candidate.lang}${candidate.localService ? ', device' : ''})`,
                    ),
                );
            }

            missing.add(item.lang);
            handlers.onMissingVoice(item.lang);
        }

        utterance.onstart = () => {
            markStarted();
            voiceLevel.setSpeaking(true, 'simulated');
            voiceLevel.bump();
        };
        // * The simulated level: a pulse for each word.
        utterance.onboundary = () => voiceLevel.pulse();
        utterance.onend = () => {
            if (current === utterance) {
                current = null;
            }

            // * A short silence before the next piece, longer after a sentence end.
            setTimeout(
                () => speakNext(index + 1),
                /[.!?。！？]$/.test(item.text)
                    ? PAUSE_AFTER_SENTENCE_MS
                    : PAUSE_AFTER_PIECE_MS,
            );
        };
        utterance.onerror = (event) => {
            if (own !== generation) {
                return;
            }

            current = null;

            if (event.error === 'canceled' || event.error === 'interrupted') {
                finish(null);

                return;
            }

            console.warn('Speech synthesis failed:', event.error);
            finish(event.error);
        };
        current = utterance;
        window.speechSynthesis.speak(utterance);
    };

    speakNext(0);

    return own;
}

/** Reads text aloud in the language of the text (several languages are read one after the other): with the webview's speech synthesis, or Vietnamese with a local VieNeu-TTS server when the settings say so. `toggle` stops it when it is already reading; `speak` reads a given text now (a voice reply). `failure` is the reason the last reading failed (null: none). */
export function useSpeechOutput(text: string) {
    const supported = 'speechSynthesis' in window;
    const [speaking, setSpeaking] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    // * The run this hook started and that is still going (null: none).
    const [runId, setRunId] = useState<number | null>(null);
    // * Another run or a stop (from anywhere) ends this one: the module's version changes then.
    useSyncExternalStore(voiceLevel.subscribe, voiceLevel.version);

    const active = runId !== null && runId === currentRun();
    // * Loaded ahead, so `toggle` can start speaking inside the click (an awaited request first may lose the user gesture the webview wants).
    const voices = useRef<SpeechSynthesisVoice[]>([]);
    const preferredVoice = useRef('');
    const vieneu = useRef<VieneuEngine | null>(null);
    const ratePercent = useRef(100);

    useEffect(() => {
        const apply = (settings: ChatSettings) => {
            const engine = {
                url: settings.vieneuUrl,
                voice: settings.vieneuVoice,
            };

            preferredVoice.current = settings.voice;
            ratePercent.current = settings.voiceRate;
            vieneu.current = settings.voiceEngine === 'vieneu' ? engine : null;

            // * No voice chosen: a voice the server says is northern, else the server's own default.
            if (vieneu.current !== null && engine.voice === '') {
                void ideSpeech.northernVoice(engine.url).then((voice) => {
                    if (vieneu.current === engine && voice !== '') {
                        engine.voice = voice;
                    }
                });
            }
        };
        const onSaved = (event: Event) =>
            apply((event as CustomEvent<ChatSettings>).detail);
        const load = () => {
            voices.current = window.speechSynthesis.getVoices();
        };

        if (supported) {
            load();
            window.speechSynthesis.addEventListener('voiceschanged', load);
        }

        window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
        ideSettings
            .get()
            .then(apply)
            .catch(() => undefined);

        return () => {
            window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);

            if (supported) {
                window.speechSynthesis.removeEventListener(
                    'voiceschanged',
                    load,
                );
            }

            stopSpeaking();
        };
    }, [supported]);

    const stop = useCallback(() => {
        stopSpeaking();
        setSpeaking(false);
        setRunId(null);
    }, []);

    const speak = useCallback(
        (spoken: string) => {
            if (!supported) {
                return;
            }

            setFailure(null);
            setSpeaking(false);

            // * The list is read again now: some webviews hand it out only after the first call.
            voices.current = window.speechSynthesis.getVoices();

            const id = speakAloud(
                spoken,
                voices.current,
                preferredVoice.current,
                { vieneu: vieneu.current, ratePercent: ratePercent.current },
                {
                    onStart: () => setSpeaking(true),
                    onVieneuFailed: (reason) =>
                        toast.warning(t('composer.vieneu_failed', { reason })),
                    onMissingVoice: (lang) =>
                        toast.warning(
                            lang === 'vi-VN'
                                ? t('composer.no_vietnamese_voice')
                                : t('composer.no_voice_for_language', {
                                      language: lang,
                                  }),
                        ),
                    onEnd: (reason) => {
                        setSpeaking(false);
                        setRunId(null);
                        setFailure(reason);
                    },
                },
            );

            setRunId(id);
        },
        [supported],
    );

    const toggle = useCallback(() => {
        if (!supported) {
            return;
        }

        if (active) {
            stop();

            return;
        }

        speak(text);
    }, [supported, active, stop, speak, text]);

    return {
        supported,
        speaking: speaking && active,
        active,
        failure,
        toggle,
        speak,
        stop,
    };
}
