import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './app';
import { useLanguage } from '@/lib/i18n';

// * Keyed by the language: changing it rebuilds the interface, so every text is read again in the new language.
function Root() {
    const language = useLanguage();

    return <App key={language} />;
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Root />
    </StrictMode>,
);
