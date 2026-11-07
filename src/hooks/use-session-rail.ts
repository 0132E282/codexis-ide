import { useEffect, useState } from 'react';
import { ideSessionRail } from '@/lib/ide-session-rail';
import type {
    RailEnvironment,
    RailGithub,
    RailOutput,
    RailUsage,
} from '@/lib/ide-session-rail';
import { ideTools } from '@/lib/ide-tools';
import type { McpServer } from '@/lib/ide-tools';

type Loaded<T> = { data: T | null; failed: boolean };

/** Loads `load` while `enabled` and again whenever `refreshKey` or `root` changes; a failure is kept apart so one block never hides the others. */
function useLoaded<T>(
    load: () => Promise<T>,
    enabled: boolean,
    dependencies: unknown[],
): Loaded<T> {
    const [state, setState] = useState<Loaded<T>>({
        data: null,
        failed: false,
    });

    useEffect(() => {
        if (!enabled) {
            return;
        }

        let cancelled = false;

        load()
            .then((data) => !cancelled && setState({ data, failed: false }))
            .catch(
                () =>
                    !cancelled && setState((now) => ({ ...now, failed: true })),
            );

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is rebuilt every render; `dependencies` says when to run it again.
    }, [enabled, ...dependencies]);

    return state;
}

/**
 * The data of the session rail's blocks (docs/system/session-rail.md): each block loads on its own.
 * `refreshKey` changes when a turn finished (new files, a branch, a pull request);
 */
export function useSessionRail({
    root,
    conversation,
    enabled,
    refreshKey,
}: {
    root: string;
    conversation: number | null;
    enabled: boolean;
    refreshKey: number;
}) {
    const environment = useLoaded<RailEnvironment>(
        () => ideSessionRail.environment(root),
        enabled,
        [root, refreshKey],
    );
    const connectors = useLoaded<McpServer[]>(
        async () => (await ideTools.mcp(root)).items,
        enabled,
        [root],
    );
    const outputs = useLoaded<RailOutput[]>(
        () =>
            conversation === null
                ? Promise.resolve([])
                : ideSessionRail.outputs(root, conversation),
        enabled,
        [root, conversation, refreshKey],
    );
    const usage = useLoaded<RailUsage>(
        () => ideSessionRail.usage(root, conversation),
        enabled,
        [root, conversation, refreshKey],
    );
    const github = useLoaded<RailGithub>(
        () => ideSessionRail.github(root),
        enabled,
        [root, refreshKey],
    );

    return { environment, connectors, outputs, usage, github };
}
