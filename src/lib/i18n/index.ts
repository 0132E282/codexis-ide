import { useSyncExternalStore } from 'react';
import { english } from './en';
import { vietnamese } from './vi';

/** Languages of the interface; Vietnamese is the language the texts were first written in. */
export type Language = 'vi' | 'en';

export const LANGUAGES: { value: Language; label: string }[] = [
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'en', label: 'English' },
];

const STORAGE_KEY = 'codexis.language';

function readSaved(): Language {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'vi';
    } catch {
        return 'vi';
    }
}

let current: Language = readSaved();
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
}

export function getLanguage(): Language {
    return current;
}

export function setLanguage(language: Language) {
    if (language === current) {
        return;
    }

    current = language;

    try {
        localStorage.setItem(STORAGE_KEY, language);
    } catch {
        // * The choice only lasts for this run when storage is blocked.
    }

    document.documentElement.lang = language;
    listeners.forEach((listener) => listener());
}

/** The language of the interface; the component re-renders when it changes. */
export function useLanguage(): Language {
    return useSyncExternalStore((listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
    }, getLanguage);
}

/**
 * The text for `key` in the chosen language. Keys are `file_name.short_text` (see `./vi` and `./en`).
 * A key with no English text shows in Vietnamese; an unknown key shows as itself.
 * `{name}` in the text is replaced by `params.name`. Call it where the text is shown (not in a constant made when the file loads), so a language change reaches it.
 */
export function t(
    key: string,
    params?: Record<string, string | number>,
): string {
    const translated =
        (current === 'en' ? english[key] : undefined) ?? vietnamese[key] ?? key;

    return params === undefined
        ? translated
        : translated.replace(/\{(\w+)\}/g, (whole, name: string) =>
              name in params ? String(params[name]) : whole,
          );
}

const ERROR_KEY = /^([a-z_]+(?:\.[a-z_]+)+)(?:\|([\s\S]*))?$/;

/**
 * The text of an error from the backend. Rust sends a fixed key (`auth.status_failed`, optionally `key|detail`); it is shown from the `errors.` texts.
 * Anything else (a message of a CLI or the system) is shown as it came.
 */
export function translateError(message: string): string {
    const match = ERROR_KEY.exec(message);

    if (match === null) {
        return message;
    }

    const key = `errors.${match[1]}`;
    const translated = t(key, { value: match[2] ?? '' });

    return translated === key ? message : translated;
}
