import { useCallback, useState } from 'react';

/** Where a dock panel sits: one of the four edges of the work area, filling all of it, or floating over it. */
export type PanelPlacement =
    'left' | 'right' | 'top' | 'bottom' | 'fill' | 'float';

export type DockedPlacement = Exclude<PanelPlacement, 'fill' | 'float'>;

const PLACEMENTS: readonly PanelPlacement[] = [
    'left',
    'right',
    'top',
    'bottom',
    'fill',
    'float',
];

function storageKey(panelId: string) {
    return `ide.placement.${panelId}`;
}

function isPlacement(value: string | null): value is PanelPlacement {
    return PLACEMENTS.includes(value as PanelPlacement);
}

function readPlacement(
    panelId: string,
    fallback: PanelPlacement,
): PanelPlacement {
    try {
        const stored = localStorage.getItem(storageKey(panelId));

        return isPlacement(stored) ? stored : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Placement of one dock panel, a display preference kept in localStorage under `ide.placement.<panelId>`.
 * An unreadable or unknown stored value gives `defaultPlacement`.
 * `dockedPlacement` is the last edge the panel sat on, so leaving `fill` or `float` goes back to it.
 */
export function usePanelPlacement(
    panelId: string,
    defaultPlacement: DockedPlacement,
) {
    const [placement, setPlacementState] = useState<PanelPlacement>(() =>
        readPlacement(panelId, defaultPlacement),
    );
    const [dockedPlacement, setDockedPlacement] = useState<DockedPlacement>(
        placement === 'fill' || placement === 'float'
            ? defaultPlacement
            : placement,
    );

    const setPlacement = useCallback(
        (next: PanelPlacement) => {
            setPlacementState(next);

            if (next !== 'fill' && next !== 'float') {
                setDockedPlacement(next);
            }

            try {
                localStorage.setItem(storageKey(panelId), next);
            } catch {
                // * Storage is unavailable: the choice holds for this session only.
            }
        },
        [panelId],
    );

    return { placement, dockedPlacement, setPlacement };
}
