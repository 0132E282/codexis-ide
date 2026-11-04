import { Sparkles } from 'lucide-react';
import { VendorBadge } from '@/components/ai-chat/vendor-badge';
import { ASSISTANT_COLORS, ASSISTANT_ICONS } from '@/lib/assistant-avatar';
import { cn } from '@/lib/utils';

export type AssistantIdentity = {
    /** Uploaded avatar (route URL): wins over the icon and the vendor logo. */
    imageUrl?: string | null;
    /** Chosen avatar icon/colour (fixed lists); both null = the AI vendor's logo. */
    icon?: string | null;
    color?: string | null;
    vendor?: { key: string; name: string };
    /** Chosen name, shown instead of "Trợ lý AI". */
    name?: string | null;
};

/** * Decorative assistant avatar: the chosen icon on its colour, else the vendor's logo, else a sparkle. */
export function AssistantAvatar({
    imageUrl,
    icon,
    color,
    vendor,
    className,
}: AssistantIdentity & { className?: string }) {
    if (imageUrl) {
        return (
            <img
                src={imageUrl}
                alt=""
                aria-hidden="true"
                className={cn(
                    'size-7 shrink-0 rounded-full object-cover',
                    className,
                )}
            />
        );
    }

    const chosen = icon ? ASSISTANT_ICONS[icon] : undefined;

    if (chosen) {
        const Icon = chosen.icon;

        return (
            <span
                aria-hidden="true"
                className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full',
                    ASSISTANT_COLORS[color ?? '']?.className ??
                        ASSISTANT_COLORS.primary.className,
                    className,
                )}
            >
                <Icon className="size-4" />
            </span>
        );
    }

    return vendor ? (
        <VendorBadge
            vendorKey={vendor.key}
            fallback={vendor.name}
            className={cn('size-7 rounded-full', className)}
        />
    ) : (
        <span
            aria-hidden="true"
            className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground',
                className,
            )}
        >
            <Sparkles className="size-4" />
        </span>
    );
}
