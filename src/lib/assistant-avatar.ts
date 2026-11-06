import { Bot, Brain, Leaf, Rocket, Sparkles, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// * Fixed avatar choices for the assistant. Same keys as `AiChatSetting::ICONS` / `COLORS` on the server (a test keeps them in sync).
export const ASSISTANT_ICONS: Record<
    string,
    { label: string; icon: LucideIcon }
> = {
    sparkles: { label: 'assistant_avatar.sparkles', icon: Sparkles },
    bot: { label: 'assistant_avatar.robot', icon: Bot },
    brain: { label: 'assistant_avatar.brain', icon: Brain },
    zap: { label: 'assistant_avatar.lightning', icon: Zap },
    rocket: { label: 'assistant_avatar.rocket', icon: Rocket },
    leaf: { label: 'assistant_avatar.leaf', icon: Leaf },
};

export const ASSISTANT_COLORS: Record<
    string,
    { label: string; className: string }
> = {
    primary: {
        label: 'common.default',
        className: 'bg-primary text-primary-foreground',
    },
    blue: {
        label: 'assistant_avatar.blue',
        className: 'bg-blue-500 text-white',
    },
    green: {
        label: 'assistant_avatar.green',
        className: 'bg-green-600 text-white',
    },
    amber: {
        label: 'assistant_avatar.amber',
        className: 'bg-amber-500 text-white',
    },
    rose: {
        label: 'assistant_avatar.pink',
        className: 'bg-rose-500 text-white',
    },
    violet: {
        label: 'assistant_avatar.purple',
        className: 'bg-violet-500 text-white',
    },
};
