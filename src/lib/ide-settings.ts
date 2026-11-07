import { invoke } from '@/lib/invoke';
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
    /** Language of the interface; empty = not chosen yet. */
    language: '' | 'vi' | 'en';
    /** Look of the interface; empty = follow the system. */
    appearance: '' | 'system' | 'light' | 'dark';
    /** Colors of the code in the editor; empty = follow the interface. */
    codeColors:
        '' | 'auto' | 'light' | 'dark' | 'light-colorblind' | 'dark-colorblind';
    /** Who reads answers aloud: the device voice or a local VieNeu-TTS server. */
    voiceEngine: 'system' | 'vieneu';
    /** Loopback address of the VieNeu-TTS server. */
    vieneuUrl: string;
    /** VieNeu-TTS voice id; empty = the server's default. */
    vieneuVoice: string;
    /** Reading speed in percent (80 to 125). */
    voiceRate: number;
    /** Also save the plans the AI writes in the chat as files in the project (off: nothing is written to the project). */
    savePlansToProject: boolean;
    /** Folder of the saved plans, relative to the project and inside it. */
    plansDir: string;
    /** Warn when the data of the IDE (logs, pictures, plans, history) grows big. */
    storageWarnings: boolean;
    /** The storage warning limits are multiplied by this (1 to 100). */
    storageWarnMultiplier: number;
};

export const DEFAULT_PLANS_DIR = 'docs/plans';
export const MAX_STORAGE_WARN_MULTIPLIER = 100;

export const DEFAULT_VIENEU_URL = 'http://127.0.0.1:8000';

export const MIN_VOICE_RATE = 80;
export const MAX_VOICE_RATE = 125;
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
    language: '',
    appearance: '',
    codeColors: '',
    voiceEngine: 'system',
    vieneuUrl: DEFAULT_VIENEU_URL,
    vieneuVoice: '',
    voiceRate: 100,
    savePlansToProject: false,
    plansDir: DEFAULT_PLANS_DIR,
    storageWarnings: true,
    storageWarnMultiplier: 1,
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

/** Settings saved before the speech fields existed come back with them empty. */
const withSpeechDefaults = (settings: ChatSettings): ChatSettings => ({
    ...settings,
    voiceEngine: settings.voiceEngine === 'vieneu' ? 'vieneu' : 'system',
    vieneuUrl: settings.vieneuUrl || DEFAULT_VIENEU_URL,
    voiceRate: settings.voiceRate || 100,
    savePlansToProject: settings.savePlansToProject === true,
    plansDir: settings.plansDir || DEFAULT_PLANS_DIR,
    storageWarnings: settings.storageWarnings !== false,
    storageWarnMultiplier: settings.storageWarnMultiplier || 1,
});

/** Raised on `window` after settings are saved, so a reader (the speech output) can pick the new ones up. */
export const SETTINGS_SAVED_EVENT = 'codexis-settings-saved';

export const ideSettings = {
    get: async () =>
        withSpeechDefaults(await invoke<ChatSettings>('settings_get')),
    save: async (settings: ChatSettings) => {
        const saved = withSpeechDefaults(
            await invoke<ChatSettings>('settings_save', { settings }),
        );

        window.dispatchEvent(
            new CustomEvent(SETTINGS_SAVED_EVENT, { detail: saved }),
        );

        return saved;
    },
    /** Changes some settings in the settings file, leaving every other setting as it is. */
    update: async (changes: Partial<ChatSettings>) =>
        ideSettings.save({ ...(await ideSettings.get()), ...changes }),
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
