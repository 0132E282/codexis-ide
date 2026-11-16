import { createContext } from 'react';

/** The folder of the project a chat belongs to, for the cards in its thread (the files an AI changed are read from, and undone in, that folder, not in the project open elsewhere); undefined outside a chat: the open project is used. */
export const ProjectRootContext = createContext<string | undefined>(undefined);
