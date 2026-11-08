import { createContext } from 'react';

/** * Lets the card of changed files in the thread open the Changes view of the code viewer owned by the workspace; null outside it (the card then has no such button). */
export const ChangesViewerContext = createContext<{
    open: () => void;
} | null>(null);
