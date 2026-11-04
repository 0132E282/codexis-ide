import { Trash2, Upload, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
                    : 'Không cập nhật được ảnh.',
            );
        }
    };

    const previewVoice = (name: string) => {
        if (!('speechSynthesis' in window)) {
            return;
        }

        const utterance = new SpeechSynthesisUtterance(
            'Xin chào, tôi là trợ lý.',
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
                <Label>Ảnh đại diện trợ lý</Label>
                <div className="flex items-center gap-3">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xs text-muted-foreground">
                        {settings.avatar === '' ? (
                            'Mặc định'
                        ) : (
                            <img
                                src={settings.avatar}
                                alt="Ảnh đại diện trợ lý"
                                className="size-full object-cover"
                            />
                        )}
                    </div>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="sr-only"
                        aria-label="Chọn ảnh đại diện"
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
                        Tải ảnh lên
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
                            Xoá ảnh
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
                    <Label htmlFor="settings-user-name">Tên AI gọi bạn</Label>
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
                    <Label htmlFor="settings-assistant-name">Tên trợ lý</Label>
                    <Input
                        id="settings-assistant-name"
                        value={settings.assistantName}
                        maxLength={MAX_NAME_LENGTH}
                        placeholder="Trợ lý AI"
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
                    <Label htmlFor="settings-voice">Giọng đọc</Label>
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
                            <option value="">Mặc định của hệ thống</option>
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
                            aria-label="Nghe thử giọng"
                            title="Nghe thử giọng"
                            className="h-9"
                            onClick={() => previewVoice(settings.voice)}
                        >
                            <Volume2 aria-hidden="true" />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Giọng có sẵn trên máy này.
                    </p>
                </div>
            )}
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-instructions">Chỉ dẫn riêng</Label>
                <textarea
                    id="settings-instructions"
                    value={settings.customInstructions}
                    maxLength={MAX_INSTRUCTIONS_LENGTH}
                    rows={6}
                    placeholder="Ví dụ: Trả lời ngắn gọn, ưu tiên ví dụ bằng Rust."
                    onChange={(event) =>
                        onChange({
                            ...settings,
                            customInstructions: event.target.value,
                        })
                    }
                    className="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-sm border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                />
                <p className="text-xs text-muted-foreground">
                    {settings.customInstructions.length} /{' '}
                    {MAX_INSTRUCTIONS_LENGTH} ký tự.
                </p>
            </div>
        </div>
    );
}
