import { invoke } from '@tauri-apps/api/core';
import { t } from '@/lib/i18n';

/** Chat settings ("Cài đặt chat"): persona and advanced options. */
export type ChatSettings = {
    /** Data URL of the assistant picture; empty = default avatar. */
    avatar: string;
    /** What the AI calls the person. */
    userName: string;
    assistantName: string;
    /** Device voice that reads answers; empty = system default. */
    voice: string;
    customInstructions: string;
    /** Empty = ask each time. */
    defaultCli: '' | 'claude' | 'codex';
    claudeModel: string;
    codexModel: string;
    /** Subscription plan of each CLI, shown in the statistics; empty = not chosen. */
    claudePlan: string;
    codexPlan: string;
    /** On a limit error the chat moves on to the next CLI of `fallbackOrder`. */
    fallbackEnabled: boolean;
    /** CLIs in the order they are tried. */
    fallbackOrder: ('claude' | 'codex')[];
};

export const MAX_NAME_LENGTH = 60;
export const MAX_INSTRUCTIONS_LENGTH = 8000;
export const MAX_MODEL_LENGTH = 100;

export const defaultChatSettings: ChatSettings = {
    avatar: '',
    userName: '',
    assistantName: '',
    voice: '',
    customInstructions: '',
    defaultCli: '',
    claudeModel: '',
    codexModel: '',
    claudePlan: '',
    codexPlan: '',
    fallbackEnabled: false,
    fallbackOrder: ['claude', 'codex'],
};

/** Plans each CLI can be marked with; the `value` is what is saved. */
export const CLI_PLANS = {
    claude: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
        { value: 'max5', label: 'Max 5x' },
        { value: 'max20', label: 'Max 20x' },
    ],
    codex: [
        { value: 'free', label: 'Free' },
        { value: 'plus', label: 'Plus' },
        { value: 'pro', label: 'Pro' },
    ],
} as const;

export const ideSettings = {
    get: () => invoke<ChatSettings>('settings_get'),
    save: (settings: ChatSettings) =>
        invoke<ChatSettings>('settings_save', { settings }),
};

/** Shrinks a picked image to a small square PNG data URL that fits the saved-size limit. */
export async function avatarDataUrl(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
        throw new Error(t('ide_settings.the_file_is_not'));
    }

    const bitmap = await createImageBitmap(file);
    const side = 256;
    const canvas = document.createElement('canvas');

    canvas.width = side;
    canvas.height = side;

    const context = canvas.getContext('2d');

    if (context === null) {
        throw new Error(t('ide_settings.could_not_process_the'));
    }

    // Cover-crop to a square.
    const crop = Math.min(bitmap.width, bitmap.height);

    context.drawImage(
        bitmap,
        (bitmap.width - crop) / 2,
        (bitmap.height - crop) / 2,
        crop,
        crop,
        0,
        0,
        side,
        side,
    );
    bitmap.close();

    return canvas.toDataURL('image/png');
}
