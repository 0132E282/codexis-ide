import type { ToolEntry } from '@/lib/ide-tools';
import { t } from '@/lib/i18n';

/** The commands the chat runs itself when the message is just `/name`; the others typed after "/" are skills. */
export const BUILTIN_COMMANDS = [
    'clear',
    'compact',
    'stop',
    'cost',
    'context',
] as const;

export type BuiltinCommand = (typeof BUILTIN_COMMANDS)[number];

/** Window event that asks the app to open the statistics dialog (`/cost`). */
export const OPEN_USAGE_EVENT = 'open-usage-dialog';

/** The built-in command the whole message names (`/clear`), or null. */
export function builtinCommandOf(message: string): BuiltinCommand | null {
    const name = /^\/(\S+)$/.exec(message.trim())?.[1].toLowerCase();

    return BUILTIN_COMMANDS.find((command) => command === name) ?? null;
}

/** The built-in commands as suggestion entries; a skill with the same name is hidden by the caller. */
export function builtinEntries(): ToolEntry[] {
    return BUILTIN_COMMANDS.map((name) => ({
        name,
        description: t(`builtin_commands.${name}`),
        model: null,
        tools: null,
        scope: 'machine',
        path: '',
        relativePath: null,
    }));
}
