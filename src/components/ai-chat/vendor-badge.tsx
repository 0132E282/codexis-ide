import { useState } from 'react';
import { ClaudeIcon } from '@/icons';
import { cn } from '@/lib/utils';

// * Brand marks are not bundled: a coloured initial stands in for each vendor logo, except Claude which has its own icon.
const VENDOR_BADGES: Record<string, { letter: string; className: string }> = {
    openai: { letter: 'O', className: 'bg-black text-white' },
    google: { letter: 'G', className: 'bg-[#4285f4] text-white' },
    deepseek: { letter: 'D', className: 'bg-[#4d6bfe] text-white' },
};

// * OpenAI's mark is loaded from its own site; the initial stands in when it cannot load.
const OPENAI_LOGO =
    'https://chatgpt.com/cdn/assets/favicon-48x48.7d42b2e65f.png';

export function VendorBadge({
    vendorKey,
    fallback,
    className,
}: {
    vendorKey: string;
    fallback: string;
    className?: string;
}) {
    const badge = VENDOR_BADGES[vendorKey];
    const [logoFailed, setLogoFailed] = useState(false);

    if (vendorKey === 'anthropic') {
        return (
            <span
                aria-hidden="true"
                className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-md bg-[#faf9f5] ring-1 ring-border',
                    className,
                )}
            >
                <ClaudeIcon className="size-[70%]" />
            </span>
        );
    }

    if (vendorKey === 'openai' && !logoFailed) {
        return (
            <span
                aria-hidden="true"
                className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-border',
                    className,
                )}
            >
                <img
                    src={OPENAI_LOGO}
                    alt=""
                    className="size-[70%]"
                    onError={() => setLogoFailed(true)}
                />
            </span>
        );
    }

    return (
        <span
            aria-hidden="true"
            className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                badge?.className ?? 'bg-muted text-muted-foreground',
                className,
            )}
        >
            {badge?.letter ?? fallback.charAt(0)}
        </span>
    );
}
