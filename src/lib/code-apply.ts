import { createContext } from 'react';

/** * Lets a file block in an AI answer write itself into the open local project (null: there is none to write to). */
export const CodeApplyContext = createContext<
    ((path: string, content: string) => Promise<void>) | null
>(null);

/** * A block title that names a file of the project: a relative path with an extension, no spaces. */
export function isFilePath(title: string): boolean {
    return /^(?!\/)(?!.*\.\.)[\w.@-]+(?:\/[\w.@-]+)*\.\w{1,10}$/.test(title);
}
