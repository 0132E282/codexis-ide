import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './app';
import { TerminalWindow } from '@/components/shell/terminal-window';
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

// * The separate terminal window loads the same page with `?terminal`.
const isTerminalWindow = new URLSearchParams(window.location.search).has(
    'terminal',
);

// * Keyed by the language: changing it rebuilds the interface, so every text is read again in the new language.
function Root() {
    const language = useLanguage();

    return isTerminalWindow ? (
        <TerminalWindow key={language} />
    ) : (
        <App key={language} />
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Root />
    </StrictMode>,
);
