import { useEffect, useRef } from 'react';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { CHAT_OPEN_WIDTH, SIDEBAR_WIDTH, TREE_MAX_WIDTH } from './constants';

/** * Widths of the file and tree columns. Either can be dragged out to the full width: the chat then shrinks, and closes once it is too narrow to use. */
export function usePanelWidths(chatCollapsed: boolean) {
    const fileWidth = useResizableWidth(
        'ai-chat.width.file',
        704,
        320,
        window.innerWidth,
    );
    const treeWidth = useResizableWidth(
        'ai-chat.width.tree',
        256,
        256,
        TREE_MAX_WIDTH,
    );

    // * The chat was opened again: the columns give back the room it needs, or it would be squeezed shut at once.
    const wasCollapsed = useRef(chatCollapsed);

    useEffect(() => {
        if (wasCollapsed.current && !chatCollapsed) {
            const room = window.innerWidth - SIDEBAR_WIDTH - CHAT_OPEN_WIDTH;

            treeWidth.shrinkTo(room - 320);
            fileWidth.shrinkTo(room - Math.min(treeWidth.width, room - 320));
        }

        wasCollapsed.current = chatCollapsed;
    }, [chatCollapsed, fileWidth, treeWidth]);

    return { fileWidth, treeWidth };
}
