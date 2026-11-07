import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSyncExternalStore } from 'react';
import type { CodeScheme } from '@/lib/code-palettes';

/** * Look of the interface: follow the system (screen) appearance, or always light or dark. */
export type Appearance = 'system' | 'light' | 'dark';

/** * Colors of the code in the editor: follow the interface, or one of the code color schemes. */
export type CodeColors = 'auto' | CodeScheme;

type ThemeState = { appearance: Appearance; codeColors: CodeColors };

const query = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

let state: ThemeState = { appearance: 'system', codeColors: 'auto' };

function applyClass() {
    const dark =
        state.appearance === 'system'
            ? query.matches
            : state.appearance === 'dark';

    document.documentElement.classList.toggle('dark', dark);

    // * The native title bar (the strip macOS draws over the window in fullscreen) follows the same look instead of the system's.
    try {
        getCurrentWindow()
            .setTheme(dark ? 'dark' : 'light')
            .catch(() => undefined);
    } catch {
        // * Not inside the app (a plain browser): there is no native window to colour.
    }
}

function notify() {
    applyClass();
    listeners.forEach((listener) => listener());
}

/** * Applies the saved look and keeps the page's `dark` class in step with the system while the look is "system". */
export function startTheme(saved: Partial<ThemeState> = {}) {
    state = { ...state, ...saved };
    query.addEventListener('change', notify);
    notify();
}

export function setAppearance(appearance: Appearance) {
    state = { ...state, appearance };
    notify();
}

export function setCodeColors(codeColors: CodeColors) {
    state = { ...state, codeColors };
    notify();
}

export function getThemeState(): ThemeState {
    return state;
}

/** * Calls `listener` whenever the look or the code colors change. */
export function subscribeTheme(listener: () => void) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

/** * The current look and code colors; the component re-renders when they change. */
export function useThemeState(): ThemeState {
    return useSyncExternalStore(subscribeTheme, getThemeState);
}

/** * The color scheme the code is shown in now: the chosen one, or light/dark following the interface. */
export function resolveCodeScheme(): CodeScheme {
    if (state.codeColors !== 'auto') {
        return state.codeColors;
    }

    return document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light';
}
