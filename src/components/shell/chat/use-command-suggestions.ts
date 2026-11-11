import { useEffect, useMemo, useState } from 'react';
import { ideTools } from '@/lib/ide-tools';
import type { ToolEntry } from '@/lib/ide-tools';
import { builtinEntries } from '@/components/shell/chat/builtin-commands';

const MAX_SUGGESTIONS = 8;

/** The same skill or agent can be found in several folders (user, project, linked copies): the list keeps the first of each name. */
function firstOfEachName(entries: ToolEntry[]): ToolEntry[] {
    const seen = new Set<string>();

    return entries.filter((entry) => {
        const key = entry.name.toLowerCase();

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}

/** The "/" (skills) and "@" (sub-agents) lists under the message box, for the text typed so far. */
export function useCommandSuggestions(value: string) {
    const [skills, setSkills] = useState<ToolEntry[]>([]);
    const [agents, setAgents] = useState<ToolEntry[]>([]);
    const [activeSuggestion, setActiveSuggestion] = useState(0);
    const [dismissed, setDismissed] = useState(false);

    // * "/" lists the skills and custom commands of this machine and project; read once.
    useEffect(() => {
        ideTools
            .skills()
            .then((listing) => setSkills(firstOfEachName(listing.items)))
            .catch(() => undefined);
        // * "@" lists the sub-agents of this machine and project.
        ideTools
            .agents()
            .then((listing) => setAgents(firstOfEachName(listing.items)))
            .catch(() => undefined);
    }, []);

    // * The list shows while the message is just "/" and the start of a name.
    const query = /^\/(\S*)$/.exec(value)?.[1].toLowerCase() ?? null;
    // * "@" and the start of a name at the end of the message (after a space or at the start) lists the sub-agents.
    const mention = /(?:^|\s)@([\w-]*)$/.exec(value)?.[1].toLowerCase() ?? null;
    const prefix = query !== null ? '/' : '@';
    const suggestions = useMemo(() => {
        // * The built-in commands come first and hide a skill of the same name.
        const builtins = builtinEntries();
        const source =
            query !== null
                ? [
                      ...builtins,
                      ...skills.filter(
                          (skill) =>
                              !builtins.some(
                                  (builtin) =>
                                      builtin.name === skill.name.toLowerCase(),
                              ),
                      ),
                  ]
                : mention !== null
                  ? agents
                  : [];
        const needle = query ?? mention;

        return needle === null
            ? []
            : source
                  .filter((entry) => entry.name.toLowerCase().includes(needle))
                  .slice(0, MAX_SUGGESTIONS);
    }, [skills, agents, query, mention]);

    return {
        prefix,
        suggestions,
        activeSuggestion,
        setActiveSuggestion,
        setDismissed,
        menuOpen: suggestions.length > 0 && !dismissed,
        /** The message with the picked entry in place of what was typed of its name. */
        completed: (entry: ToolEntry) =>
            query !== null
                ? `/${entry.name} `
                : value.replace(/@([\w-]*)$/, `@agent-${entry.name} `),
    };
}
