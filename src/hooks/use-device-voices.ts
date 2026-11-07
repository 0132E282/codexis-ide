import { useEffect, useState } from 'react';

/** How natural a device voice is likely to sound, from its name: premium and enhanced voices are downloads, the rest are the compact built-in ones. */
export type VoiceQuality = 'premium' | 'enhanced' | 'natural' | 'standard';

export type DeviceVoice = {
    name: string;
    lang: string;
    quality: VoiceQuality;
};

const RANK: Record<VoiceQuality, number> = {
    premium: 0,
    enhanced: 1,
    natural: 2,
    standard: 3,
};

export function voiceQuality(name: string): VoiceQuality {
    if (/premium/i.test(name)) {
        return 'premium';
    }

    if (/enhanced/i.test(name)) {
        return 'enhanced';
    }

    return /siri|natural/i.test(name) ? 'natural' : 'standard';
}

/** Voices of this device, Vietnamese first and the more natural ones first; empty when the webview has no speech synthesis. */
export function useDeviceVoices(): DeviceVoice[] {
    const [voices, setVoices] = useState<DeviceVoice[]>([]);

    useEffect(() => {
        if (!('speechSynthesis' in window)) {
            return;
        }

        const load = () =>
            setVoices(
                window.speechSynthesis
                    .getVoices()
                    .map((voice) => ({
                        name: voice.name,
                        lang: voice.lang,
                        quality: voiceQuality(voice.name),
                    }))
                    .sort(
                        (a, b) =>
                            Number(b.lang.toLowerCase().startsWith('vi')) -
                                Number(a.lang.toLowerCase().startsWith('vi')) ||
                            RANK[a.quality] - RANK[b.quality],
                    ),
            );

        load();
        window.speechSynthesis.addEventListener('voiceschanged', load);

        return () =>
            window.speechSynthesis.removeEventListener('voiceschanged', load);
    }, []);

    return voices;
}
