import { useEffect, useState } from 'react';

/** Names of the voices of this device; empty when the webview has no speech synthesis. */
export function useDeviceVoices(): string[] {
    const [voices, setVoices] = useState<string[]>([]);

    useEffect(() => {
        if (!('speechSynthesis' in window)) {
            return;
        }

        const load = () =>
            setVoices(
                window.speechSynthesis.getVoices().map((voice) => voice.name),
            );

        load();
        window.speechSynthesis.addEventListener('voiceschanged', load);

        return () =>
            window.speechSynthesis.removeEventListener('voiceschanged', load);
    }, []);

    return voices;
}
