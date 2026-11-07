import { useCallback, useEffect, useRef, useState } from 'react';
import { getLanguage } from '@/lib/i18n';

// * The browser's speech recognition is not in the TypeScript DOM library yet.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = {
    resultIndex: number;
    results: { length: number; [index: number]: RecognitionResult };
};
type Recognition = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: RecognitionEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    onaudiostart: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

const NO_AUDIO_TIMEOUT_MS = 8000;
const RECOGNITION_LANGUAGES = { vi: 'vi-VN', en: 'en-US' } as const;

function getRecognitionConstructor(): RecognitionConstructor | undefined {
    const scope = window as unknown as {
        SpeechRecognition?: RecognitionConstructor;
        webkitSpeechRecognition?: RecognitionConstructor;
    };

    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/**
 * Dictation into the message box with the webview's speech recognition (a browser API, so the only logic of the box that lives in the front end).
 * `interim` is the words still being recognised (shown after the text); each final phrase goes to `onFinal`. Listening stops when `active` turns false (a turn is running) and when the box goes away.
 */
export function useSpeechInput(
    onFinal: (phrase: string) => void,
    active: boolean,
) {
    const supported = getRecognitionConstructor() !== undefined;
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [failed, setFailed] = useState(false);
    const recognition = useRef<Recognition | null>(null);
    const latestOnFinal = useRef(onFinal);

    useEffect(() => {
        latestOnFinal.current = onFinal;
    }, [onFinal]);

    // * Raised while listening is wanted: the end of a recognition is never restarted, and a stop is final at once.
    const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearNoAudioTimer = useCallback(() => {
        if (timeout.current !== null) {
            window.clearTimeout(timeout.current);
            timeout.current = null;
        }
    }, []);

    // * Stops at once (`abort`, not `stop`, which waits for a final result that may never come) and does not wait for `onend`.
    const stop = useCallback(() => {
        const current = recognition.current;

        clearNoAudioTimer();
        recognition.current = null;
        setListening(false);
        setInterim('');
        // * A stop is also how a failure notice is dismissed.
        setFailed(false);

        if (current !== null) {
            current.onresult = null;
            current.onerror = null;
            current.onend = null;
            current.onaudiostart = null;
            current.abort();
        }
    }, [clearNoAudioTimer]);

    const start = useCallback(() => {
        const Constructor = getRecognitionConstructor();

        if (Constructor === undefined) {
            return;
        }

        const next = new Constructor();

        next.lang = RECOGNITION_LANGUAGES[getLanguage()];
        next.continuous = true;
        next.interimResults = true;
        next.onaudiostart = clearNoAudioTimer;
        next.onresult = (event) => {
            clearNoAudioTimer();

            let pending = '';

            for (
                let index = event.resultIndex;
                index < event.results.length;
                index++
            ) {
                const result = event.results[index];

                if (result.isFinal) {
                    latestOnFinal.current(result[0].transcript.trim());
                } else {
                    pending += result[0].transcript;
                }
            }

            setInterim(pending);
        };
        next.onerror = (event) => {
            // * Denied microphone or no speech service: the button shows it instead of looking stuck.
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                setFailed(true);
            }
        };
        next.onend = () => {
            clearNoAudioTimer();
            recognition.current = null;
            setListening(false);
            setInterim('');
        };
        recognition.current = next;
        setFailed(false);
        setListening(true);
        next.start();
        // * No sound at all for a while (the service hangs): listening closes and shows the failure.
        clearNoAudioTimer();
        timeout.current = window.setTimeout(() => {
            if (recognition.current === next) {
                stop();
                setFailed(true);
            }
        }, NO_AUDIO_TIMEOUT_MS);
    }, [clearNoAudioTimer, stop]);

    const toggle = useCallback(() => {
        if (recognition.current === null) {
            start();
        } else {
            stop();
        }
    }, [start, stop]);

    useEffect(() => {
        if (!active) {
            stop();
        }
    }, [active, stop]);

    useEffect(() => stop, [stop]);

    return { supported, listening, interim, failed, toggle, stop };
}
