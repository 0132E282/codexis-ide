import { Bot, Brain, Leaf, Rocket, Sparkles, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// * Fixed avatar choices for the assistant. Same keys as `AiChatSetting::ICONS` / `COLORS` on the server (a test keeps them in sync).
export const ASSISTANT_ICONS: Record<
    string,
    { label: string; icon: LucideIcon }
> = {
    sparkles: { label: 'Tia sáng', icon: Sparkles },
    bot: { label: 'Robot', icon: Bot },
    brain: { label: 'Bộ não', icon: Brain },
    zap: { label: 'Tia chớp', icon: Zap },
    rocket: { label: 'Tên lửa', icon: Rocket },
    leaf: { label: 'Lá cây', icon: Leaf },
};

export const ASSISTANT_COLORS: Record<
    string,
    { label: string; className: string }
> = {
    primary: {
        label: 'Mặc định',
        className: 'bg-primary text-primary-foreground',
    },
    blue: { label: 'Xanh dương', className: 'bg-blue-500 text-white' },
    green: { label: 'Xanh lá', className: 'bg-green-600 text-white' },
    amber: { label: 'Hổ phách', className: 'bg-amber-500 text-white' },
    rose: { label: 'Hồng', className: 'bg-rose-500 text-white' },
    violet: { label: 'Tím', className: 'bg-violet-500 text-white' },
};
