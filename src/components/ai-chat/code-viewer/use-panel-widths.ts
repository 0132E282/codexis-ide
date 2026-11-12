import { useEffect, useRef } from 'react';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import {
    CHANGES_PANEL_DEFAULT_WIDTH,
    CHAT_OPEN_WIDTH,
    FILE_PANEL_DEFAULT_WIDTH,
    SIDEBAR_WIDTH,
    TREE_MAX_WIDTH,
} from './constants';

// * The narrowest chat that stays usable beside the columns.
const CHAT_MIN_WIDTH = 288;

/** * Widths of the file and tree columns. Either can be dragged out to the full width: the chat then shrinks, and closes once it is too narrow to use. */
export function usePanelWidths(
    chatCollapsed: boolean,
    treeEdge: 'leading' | 'trailing' = 'leading',
) {
    const chatReserve = chatCollapsed ? 0 : CHAT_MIN_WIDTH;
    // * The tree may grow only while a file column (320 at least) and a usable chat still fit beside it.
    const treeMax = () =>
        Math.max(
            256,
            Math.min(
                TREE_MAX_WIDTH,
                window.innerWidth - SIDEBAR_WIDTH - 320 - chatReserve,
            ),
        );
    const treeWidth = useResizableWidth(
        'ai-chat.width.tree',
        256,
        256,
        treeMax,
        'x',
        // * The tree on the left of the editor is dragged by its right edge.
        treeEdge,
    );
    // * The room a column may take: the window less the sidebar and the tree as it is now, and less a usable chat while the chat is open.
    const columnMax = () =>
        window.innerWidth - SIDEBAR_WIDTH - treeWidth.width - chatReserve;
    const fileWidth = useResizableWidth(
        'ai-chat.width.file',
        FILE_PANEL_DEFAULT_WIDTH,
        320,
        columnMax,
        'x',
        // * With the tree on the left, the file column's drag bar is on its right edge, like the tree's.
        treeEdge === 'trailing' ? 'trailing' : 'leading',
    );
    const changesWidth = useResizableWidth(
        'ai-chat.width.changes',
        CHANGES_PANEL_DEFAULT_WIDTH,
        320,
        columnMax,
        'x',
        // * With the tree on the left, the change list is beside the chat's side of the tree: dragged by its right edge like the tree.
        treeEdge === 'trailing' ? 'trailing' : 'leading',
    );

    // * Mounted with the chat open, or the chat was opened again: the columns (only in memory, the saved widths stay) give the chat the room it needs, or it would be squeezed shut at once and leave a gap.
    const wasCollapsed = useRef(true);

    useEffect(() => {
        if (wasCollapsed.current && !chatCollapsed) {
            const room = window.innerWidth - SIDEBAR_WIDTH - CHAT_OPEN_WIDTH;

            treeWidth.shrinkTo(room - 320);
            fileWidth.shrinkTo(room - Math.min(treeWidth.width, room - 320));
            changesWidth.shrinkTo(room - Math.min(treeWidth.width, room - 320));
        }

        wasCollapsed.current = chatCollapsed;
    }, [chatCollapsed, fileWidth, changesWidth, treeWidth]);

    return { fileWidth, changesWidth, treeWidth };
}
