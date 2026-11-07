import { useEffect, useId, useState } from 'react';
import { useThemeState } from '@/lib/system-theme';
import { t } from '@/lib/i18n';

type Rendered = { source: string; dark: boolean; svg: string | null };

/** A ```mermaid block drawn as a diagram (the library loads only when one is shown); the source stays as plain text while it loads or when it cannot be drawn. */
export function MermaidBlock({ code }: { code: string }) {
    const identifier = `mermaid-${useId().replace(/\W/g, '')}`;
    // * Read again when the interface switches between light and dark.
    useThemeState();
    const dark = document.documentElement.classList.contains('dark');
    const [rendered, setRendered] = useState<Rendered | null>(null);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            let svg: string | null = null;

            try {
                const { default: mermaid } = await import('mermaid');

                // * `strict` keeps scripts and HTML in labels out of the drawing.
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'strict',
                    theme: dark ? 'dark' : 'default',
                });
                svg = (await mermaid.render(identifier, code)).svg;
            } catch {
                // * A syntax error shows the source instead.
            }

            if (!cancelled) {
                setRendered({ source: code, dark, svg });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [code, dark, identifier]);

    const current =
        rendered?.source === code && rendered.dark === dark ? rendered : null;

    if (current?.svg) {
        return (
            <div
                role="img"
                aria-label={t('mermaid_block.diagram')}
                className="my-3 overflow-x-auto rounded-lg border border-border bg-card p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
                dangerouslySetInnerHTML={{ __html: current.svg }}
            />
        );
    }

    return (
        <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-relaxed">
            {code}
        </pre>
    );
}
