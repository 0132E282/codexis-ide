import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import './index.css';
import App from './app';
import { setLanguage, useLanguage } from '@/lib/i18n';
import { ideSettings } from '@/lib/ide-settings';
import { setAppearance, setCodeColors, startTheme } from '@/lib/system-theme';

// * Until the settings file is read the interface follows the system.
startTheme();

// * The language, look and code colors kept in the settings file win over the browser's cached copy (that only avoids a flash on start-up).
ideSettings
    .get()
    .then(({ language, appearance, codeColors }) => {
        if (language !== '') {
            setLanguage(language);
        }

        setAppearance(appearance === '' ? 'system' : appearance);
        setCodeColors(codeColors === '' ? 'auto' : codeColors);
    })
    .catch(() => undefined);

// * The separate terminal window is fetched only inside that window, so the main window does not carry the bottom panel's code at start-up.
const TerminalWindow = lazy(() =>
    import('@/components/shell/terminal-window').then((module) => ({
        default: module.TerminalWindow,
    })),
);

// * The separate code window (files, editor, terminal) is a light page of its own too, chosen by `?view=code`.
const CodeWindow = lazy(() =>
    import('@/components/shell/code-window').then((module) => ({
        default: module.CodeWindow,
    })),
);

const isCodeWindow =
    new URLSearchParams(window.location.search).get('view') === 'code';

// * The separate terminal window loads the same page with `?terminal`.
const isTerminalWindow = new URLSearchParams(window.location.search).has(
    'terminal',
);

// * Keyed by the language: changing it rebuilds the interface, so every text is read again in the new language.
function Root() {
    const language = useLanguage();

    // * Every `toast(...)` of the app shows here; without a Toaster none of them is seen.
    return (
        <>
            {isTerminalWindow ? (
                <Suspense fallback={null}>
                    <TerminalWindow key={language} />
                </Suspense>
            ) : isCodeWindow ? (
                <Suspense fallback={null}>
                    <CodeWindow key={language} />
                </Suspense>
            ) : (
                <App key={language} />
            )}
            <Toaster richColors />
        </>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Root />
    </StrictMode>,
);
