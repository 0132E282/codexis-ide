import { createContext } from 'react';
import type { ViewerFile } from '@/lib/viewer-file';

/** * Lets a file card in the thread open the viewer owned by the page; null outside the AI chat (cards then stay plain code blocks). */
export const FileViewerContext = createContext<{
    open: (file: ViewerFile) => void;
} | null>(null);
