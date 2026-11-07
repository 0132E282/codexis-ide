import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import {
    MAX_VOICE_RATE,
    MIN_VOICE_RATE,
    type ChatSettings,
} from '@/lib/ide-settings';
import { ideSpeech, type SpeechVoice } from '@/lib/ide-speech';

const RATES = [MIN_VOICE_RATE, 90, 100, 110, MAX_VOICE_RATE];
const REGIONS = ['north', 'central', 'south', ''] as const;
const SELECT_CLASS =
    'h-9 min-w-0 w-full rounded-sm border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Settings of how answers are read aloud: the engine (system voice or a local VieNeu-TTS server), its address and voice with a connection check, the speed, and how to run the server. */
export function SpeechEngineSection({
    settings,
    onChange,
}: {
    settings: ChatSettings;
    onChange: (settings: ChatSettings) => void;
}) {
    const [checking, setChecking] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    // * `null`: not checked yet.
    const [reachable, setReachable] = useState<boolean | null>(null);
    const [voices, setVoices] = useState<SpeechVoice[]>([]);
    const [error, setError] = useState('');
    const vieneu = settings.voiceEngine === 'vieneu';

    const check = async () => {
        setChecking(true);
        setError('');

        try {
            const status = await ideSpeech.status(settings.vieneuUrl);

            setReachable(status.reachable);
            setVoices(status.voices);
        } catch (caught) {
            setReachable(false);
            setVoices([]);
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setChecking(false);
        }
    };

    const preview = async () => {
        setPreviewing(true);
        setError('');

        try {
            const reply = await ideSpeech.synthesize(
                settings.vieneuUrl,
                settings.vieneuVoice,
                t('voice_quick.sample'),
                settings.voiceRate,
            );
            const bytes = Uint8Array.from(atob(reply.wavBase64), (character) =>
                character.charCodeAt(0),
            );
            const url = URL.createObjectURL(
                new Blob([bytes], { type: 'audio/wav' }),
            );
            const audio = new Audio(url);

            audio.onended = () => URL.revokeObjectURL(url);
            await audio.play();
        } catch (caught) {
            setReachable(false);
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <>
            <Field>
                <FieldLabel className="mb-4">
                    {t('speech_engine.label')}
                </FieldLabel>
                <div
                    role="radiogroup"
                    aria-label={t('speech_engine.label')}
                    className="flex flex-wrap gap-1.5"
                >
                    {(['system', 'vieneu'] as const).map((engine) => (
                        <button
                            key={engine}
                            type="button"
                            role="radio"
                            aria-checked={settings.voiceEngine === engine}
                            onClick={() =>
                                onChange({ ...settings, voiceEngine: engine })
                            }
                            className={`h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                                settings.voiceEngine === engine
                                    ? 'border-primary bg-accent'
                                    : 'hover:bg-muted'
                            }`}
                        >
                            {t(`speech_engine.${engine}`)}
                        </button>
                    ))}
                </div>
                <FieldDescription>{t('speech_engine.hint')}</FieldDescription>
            </Field>
            {vieneu && (
                <>
                    <Field>
                        <FieldLabel htmlFor="settings-vieneu-url">
                            {t('speech_engine.url')}
                        </FieldLabel>
                        <div className="flex gap-2">
                            <Input
                                id="settings-vieneu-url"
                                value={settings.vieneuUrl}
                                maxLength={200}
                                spellCheck={false}
                                onChange={(event) =>
                                    onChange({
                                        ...settings,
                                        vieneuUrl: event.target.value,
                                    })
                                }
                            />
                            <Button
                                type="button"
                                variant="outline"
                                className="h-9"
                                disabled={checking}
                                onClick={() => void check()}
                            >
                                {checking
                                    ? t('speech_engine.checking')
                                    : t('speech_engine.check')}
                            </Button>
                        </div>
                        {reachable !== null && (
                            <p
                                role="status"
                                className={`text-sm ${reachable ? 'text-green-600' : 'text-amber-500'}`}
                            >
                                {reachable
                                    ? t('speech_engine.connected', {
                                          count: String(voices.length),
                                      })
                                    : error || t('speech_engine.not_connected')}
                            </p>
                        )}
                        <FieldDescription>
                            {t('speech_engine.guide')}
                        </FieldDescription>
                        <FieldDescription>
                            {t('speech_engine.license')}
                        </FieldDescription>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="settings-vieneu-voice">
                            {t('speech_engine.voice')}
                        </FieldLabel>
                        <select
                            id="settings-vieneu-voice"
                            value={settings.vieneuVoice}
                            onChange={(event) =>
                                onChange({
                                    ...settings,
                                    vieneuVoice: event.target.value,
                                })
                            }
                            className={SELECT_CLASS}
                        >
                            <option value="">
                                {t('speech_engine.default_voice')}
                            </option>
                            {settings.vieneuVoice !== '' &&
                                !voices.some(
                                    (voice) =>
                                        voice.id === settings.vieneuVoice,
                                ) && (
                                    <option value={settings.vieneuVoice}>
                                        {settings.vieneuVoice}
                                    </option>
                                )}
                            {REGIONS.map((region) => {
                                const group = voices.filter(
                                    (voice) => voice.region === region,
                                );

                                return group.length === 0 ? null : (
                                    <optgroup
                                        key={region}
                                        label={t(
                                            `voice_quick.region_${region === '' ? 'unknown' : region}`,
                                        )}
                                    >
                                        {group.map((voice) => (
                                            <option
                                                key={voice.id}
                                                value={voice.id}
                                            >
                                                {voice.name}
                                            </option>
                                        ))}
                                    </optgroup>
                                );
                            })}
                        </select>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-fit"
                            disabled={previewing}
                            onClick={() => void preview()}
                        >
                            <Volume2 aria-hidden="true" />
                            {t('voice_quick.preview')}
                        </Button>
                        <FieldDescription>
                            {t('speech_engine.voice_hint')}
                        </FieldDescription>
                    </Field>
                </>
            )}
            <Field>
                <FieldLabel htmlFor="settings-voice-rate">
                    {t('voice_quick.speed')}
                </FieldLabel>
                <select
                    id="settings-voice-rate"
                    value={settings.voiceRate}
                    onChange={(event) =>
                        onChange({
                            ...settings,
                            voiceRate: Number(event.target.value),
                        })
                    }
                    className={SELECT_CLASS}
                >
                    {RATES.map((rate) => (
                        <option key={rate} value={rate}>
                            {(rate / 100).toFixed(2).replace(/0$/, '')}x
                        </option>
                    ))}
                </select>
            </Field>
        </>
    );
}
