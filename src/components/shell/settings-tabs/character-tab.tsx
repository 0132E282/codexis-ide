import { Trash2, Upload, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import {
    avatarDataUrl,
    MAX_INSTRUCTIONS_LENGTH,
    MAX_NAME_LENGTH,
} from '@/lib/ide-settings';
import type { ChatSettings } from '@/lib/ide-settings';

/** Device voices; empty when the webview has no speech synthesis. */
function useDeviceVoices(): string[] {
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

/** Settings tab "Nhân vật": avatar, names, voice and custom instructions. */
export function CharacterTab({
    settings,
    onChange,
}: {
    settings: ChatSettings;
    onChange: (settings: ChatSettings) => void;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const voices = useDeviceVoices();

    const pickAvatar = async (file: File) => {
        setAvatarError(null);

        try {
            onChange({ ...settings, avatar: await avatarDataUrl(file) });
        } catch (caught) {
            setAvatarError(
                caught instanceof Error
                    ? caught.message
                    : t('character_tab.could_not_update_the'),
            );
        }
    };

    const previewVoice = (name: string) => {
        if (!('speechSynthesis' in window)) {
            return;
        }

        const utterance = new SpeechSynthesisUtterance(
            t('character_tab.hello_iam_your'),
        );
        const voice = window.speechSynthesis
            .getVoices()
            .find((item) => item.name === name);

        if (voice) {
            utterance.voice = voice;
        }

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
                <Label>{t('character_tab.assistant_picture')}</Label>
                <div className="flex items-center gap-3">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xs text-muted-foreground">
                        {settings.avatar === '' ? (
                            t('common.default')
                        ) : (
                            <img
                                src={settings.avatar}
                                alt={t('character_tab.assistant_picture')}
                                className="size-full object-cover"
                            />
                        )}
                    </div>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="sr-only"
                        aria-label={t('character_tab.choose_apicture')}
                        tabIndex={-1}
                        onChange={(event) => {
                            const file = event.target.files?.[0];

                            event.target.value = '';

                            if (file) {
                                void pickAvatar(file);
                            }
                        }}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInput.current?.click()}
                    >
                        <Upload aria-hidden="true" />
                        {t('character_tab.upload_picture')}
                    </Button>
                    {settings.avatar !== '' && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            onClick={() =>
                                onChange({ ...settings, avatar: '' })
                            }
                        >
                            <Trash2 aria-hidden="true" />
                            {t('character_tab.remove_picture')}
                        </Button>
                    )}
                </div>
                {avatarError !== null && (
                    <p role="alert" className="text-sm text-destructive">
                        {avatarError}
                    </p>
                )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="settings-user-name">
                        {t('character_tab.name_the_ai_calls')}
                    </Label>
                    <Input
                        id="settings-user-name"
                        value={settings.userName}
                        maxLength={MAX_NAME_LENGTH}
                        onChange={(event) =>
                            onChange({
                                ...settings,
                                userName: event.target.value,
                            })
                        }
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="settings-assistant-name">
                        {t('character_tab.assistant_name')}
                    </Label>
                    <Input
                        id="settings-assistant-name"
                        value={settings.assistantName}
                        maxLength={MAX_NAME_LENGTH}
                        placeholder={t('common.ai_assistant')}
                        onChange={(event) =>
                            onChange({
                                ...settings,
                                assistantName: event.target.value,
                            })
                        }
                    />
                </div>
            </div>
            {voices.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="settings-voice">
                        {t('character_tab.voice')}
                    </Label>
                    <div className="flex gap-2">
                        <select
                            id="settings-voice"
                            value={settings.voice}
                            onChange={(event) =>
                                onChange({
                                    ...settings,
                                    voice: event.target.value,
                                })
                            }
                            className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-sm border px-3 text-sm outline-none focus-visible:ring-[3px]"
                        >
                            <option value="">
                                {t('character_tab.system_default')}
                            </option>
                            {voices.map((name) => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                        </select>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={t('character_tab.preview_voice')}
                            title={t('character_tab.preview_voice')}
                            className="h-9"
                            onClick={() => previewVoice(settings.voice)}
                        >
                            <Volume2 aria-hidden="true" />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {t('character_tab.voices_available_on_this')}
                    </p>
                </div>
            )}
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-instructions">
                    {t('character_tab.custom_instructions')}
                </Label>
                <textarea
                    id="settings-instructions"
                    value={settings.customInstructions}
                    maxLength={MAX_INSTRUCTIONS_LENGTH}
                    rows={6}
                    placeholder={t('character_tab.for_example_answer_briefly')}
                    onChange={(event) =>
                        onChange({
                            ...settings,
                            customInstructions: event.target.value,
                        })
                    }
                    className="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-sm border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                />
                <p className="text-xs text-muted-foreground">
                    {t('character_tab.count_max_characters', {
                        count: settings.customInstructions.length,
                        max: MAX_INSTRUCTIONS_LENGTH,
                    })}
                </p>
            </div>
        </div>
    );
}
