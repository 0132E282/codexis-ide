import { Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { CodePreview } from '@/components/shell/settings-tabs/code-preview';
import { Button } from '@/components/ui/button';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from '@/components/ui/field';
import { useDeviceVoices } from '@/hooks/use-device-voices';
import { LANGUAGES, setLanguage, useLanguage, t } from '@/lib/i18n';
import { ideSettings } from '@/lib/ide-settings';
import type { ChatSettings } from '@/lib/ide-settings';
import {
    setAppearance,
    setCodeColors,
    useThemeState,
    type Appearance,
    type CodeColors,
} from '@/lib/system-theme';

const APPEARANCES: { value: Appearance; label: string }[] = [
    { value: 'system', label: 'advanced_tab.appearance_system' },
    { value: 'light', label: 'advanced_tab.appearance_light' },
    { value: 'dark', label: 'advanced_tab.appearance_dark' },
];

const CODE_COLORS: { value: CodeColors; label: string }[] = [
    { value: 'auto', label: 'advanced_tab.code_colors_auto' },
    { value: 'light', label: 'advanced_tab.appearance_light' },
    { value: 'dark', label: 'advanced_tab.appearance_dark' },
    { value: 'light-colorblind', label: 'advanced_tab.code_colors_light_cb' },
    { value: 'dark-colorblind', label: 'advanced_tab.code_colors_dark_cb' },
];

/** One row of mutually exclusive buttons. */
function Choice<Value extends string>({
    label,
    hint,
    options,
    value,
    onSelect,
    stacked = false,
    aside,
}: {
    /** One button per row (a column) instead of side by side. */
    stacked?: boolean;
    /** Shown to the right of the buttons, as tall as the buttons are. */
    aside?: ReactNode;
    label: string;
    hint: string;
    options: { value: Value; label: string }[];
    value: Value;
    onSelect: (value: Value) => void;
}) {
    return (
        <Field>
            <FieldLabel className="mb-4">{label}</FieldLabel>
            <div
                className={
                    aside === undefined
                        ? undefined
                        : 'grid gap-4 sm:grid-cols-2'
                }
            >
                <div
                    role="radiogroup"
                    aria-label={label}
                    className={
                        stacked
                            ? 'flex flex-col gap-1.5'
                            : 'flex flex-wrap gap-1.5'
                    }
                >
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={value === option.value}
                            onClick={() => onSelect(option.value)}
                            className={`h-9 rounded-md border px-3 text-sm ${stacked ? 'w-full text-left' : ''} focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                                value === option.value
                                    ? 'border-primary bg-accent'
                                    : 'hover:bg-muted'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                {aside}
            </div>
            <FieldDescription>{hint}</FieldDescription>
        </Field>
    );
}

/** Settings tab "Nâng cao": display language, light/dark look and the colors of the code. Each choice applies at once and is kept in the settings file. */
export function AdvancedTab({
    settings,
    onChange,
}: {
    settings: ChatSettings;
    onChange: (settings: ChatSettings) => void;
}) {
    const language = useLanguage();
    const voices = useDeviceVoices();

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

    const { appearance, codeColors } = useThemeState();

    return (
        <FieldGroup>
            <Choice
                label={t('advanced_tab.language')}
                hint={t('advanced_tab.display_language_of_the')}
                options={LANGUAGES}
                value={language}
                onSelect={(value) => {
                    setLanguage(value);
                    onChange({ ...settings, language: value });
                    // * The settings file is where the choice is kept; the browser storage only speeds up the first paint.
                    void ideSettings
                        .update({ language: value })
                        .catch(() => undefined);
                }}
            />
            <Choice
                label={t('advanced_tab.appearance')}
                hint={t('advanced_tab.appearance_hint')}
                options={APPEARANCES.map((option) => ({
                    value: option.value,
                    label: t(option.label),
                }))}
                value={appearance}
                onSelect={(value) => {
                    setAppearance(value);
                    onChange({ ...settings, appearance: value });
                    void ideSettings
                        .update({ appearance: value })
                        .catch(() => undefined);
                }}
            />
            <Choice
                stacked
                aside={<CodePreview />}
                label={t('advanced_tab.code_colors')}
                hint={t('advanced_tab.code_colors_hint')}
                options={CODE_COLORS.map((option) => ({
                    value: option.value,
                    label: t(option.label),
                }))}
                value={codeColors}
                onSelect={(value) => {
                    setCodeColors(value);
                    onChange({ ...settings, codeColors: value });
                    void ideSettings
                        .update({ codeColors: value })
                        .catch(() => undefined);
                }}
            />
            {voices.length > 0 && (
                <Field>
                    <FieldLabel htmlFor="settings-voice">
                        {t('character_tab.voice')}
                    </FieldLabel>
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
                            className="h-9 min-w-0 flex-1 rounded-sm border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                    <FieldDescription>
                        {t('character_tab.voices_available_on_this')}
                    </FieldDescription>
                </Field>
            )}
        </FieldGroup>
    );
}
