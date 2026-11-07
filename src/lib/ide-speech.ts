import { invoke } from '@/lib/invoke';

export type VoiceRegion = '' | 'north' | 'central' | 'south';
/** `region` is what the server says about the voice (empty: it does not say; a name alone is never guessed from). */
export type SpeechVoice = { id: string; name: string; region: VoiceRegion };
export type SpeechStatus = { reachable: boolean; voices: SpeechVoice[] };

// * The default voice found for each server, kept for the session.
const northernVoices = new Map<string, Promise<string>>();

/** Client of the local VieNeu-TTS server (the Rust side talks to it). */
export const ideSpeech = {
    status: (baseUrl: string) =>
        invoke<SpeechStatus>('speech_status', { baseUrl }),
    /** The spoken text as a base64 WAV file; `speedPercent` (80 to 125) is passed to the server, which may ignore it. */
    synthesize: (
        baseUrl: string,
        voice: string,
        text: string,
        speedPercent?: number,
    ) =>
        invoke<{ wavBase64: string }>('speech_synthesize', {
            baseUrl,
            voice,
            text,
            speedPercent: speedPercent ?? null,
        }),
    /** The first voice of the server that says it speaks the northern accent; empty when none says so (the server's own default stays). */
    northernVoice(baseUrl: string): Promise<string> {
        const known = northernVoices.get(baseUrl);

        if (known !== undefined) {
            return known;
        }

        const pending = ideSpeech
            .status(baseUrl)
            .then((status) => {
                if (!status.reachable) {
                    northernVoices.delete(baseUrl);
                }

                return (
                    status.voices.find((voice) => voice.region === 'north')
                        ?.id ?? ''
                );
            })
            .catch(() => {
                northernVoices.delete(baseUrl);

                return '';
            });

        northernVoices.set(baseUrl, pending);

        return pending;
    },
};
