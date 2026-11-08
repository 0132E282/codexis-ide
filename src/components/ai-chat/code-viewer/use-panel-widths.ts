import { useEffect, useRef } from 'react';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import {
    CHANGES_PANEL_DEFAULT_WIDTH,
    CHAT_OPEN_WIDTH,
    FILE_PANEL_DEFAULT_WIDTH,
    SIDEBAR_WIDTH,
    TREE_MAX_WIDTH,
} from './constants';

/** * Widths of the file and tree columns. Either can be dragged out to the full width: the chat then shrinks, and closes once it is too narrow to use. */
export function usePanelWidths(
    chatCollapsed: boolean,
    treeEdge: 'leading' | 'trailing' = 'leading',
) {
    const fileWidth = useResizableWidth(
        'ai-chat.width.file',
        FILE_PANEL_DEFAULT_WIDTH,
        320,
        window.innerWidth,
        'x',
        // * With the tree on the left, the file column's drag bar is on its right edge, like the tree's.
        treeEdge === 'trailing' ? 'trailing' : 'leading',
    );
    const changesWidth = useResizableWidth(
        'ai-chat.width.changes',
        CHANGES_PANEL_DEFAULT_WIDTH,
        320,
        window.innerWidth,
        'x',
        // * With the tree on the left, the change list is beside the chat's side of the tree: dragged by its right edge like the tree.
        treeEdge === 'trailing' ? 'trailing' : 'leading',
    );
    const treeWidth = useResizableWidth(
        'ai-chat.width.tree',
        256,
        256,
        TREE_MAX_WIDTH,
        'x',
        // * The tree on the left of the editor is dragged by its right edge.
        treeEdge,
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
