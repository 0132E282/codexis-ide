import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pane } from '@/hooks/use-pane-state';
import {
    errorText,
    ide,
    type ChatConversation,
    type Project,
    type ProjectInfo,
} from '@/lib/ide';

// * Key of the pane of the start-up workspace, which is not a saved project.
export const STARTUP_KEY = 'startup';

/** Projects, the panes opened for them, which are on screen, and the conversations of the open project. */
export function useWorkspace() {
    const [name, setName] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState(false);
    const [panes, setPanes] = useState<Pane[]>([]);
    // * Keys of the panes on screen.
    const [view, setView] = useState<string[]>([]);
    // * The startup folder (listed while no project is saved) is only hidden: there is nothing saved to remove.
    const [startupHidden, setStartupHidden] = useState(false);
    // * Conversations of the open project (listed under it in the sidebar).
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const activeKey = activeId ?? STARTUP_KEY;
    const activePane = panes.find((pane) => pane.key === activeKey) ?? null;
    const activeRoot = activePane?.root ?? null;
    const activeRootRef = useRef<string | null>(null);

    useEffect(() => {
        activeRootRef.current = activeRoot;
    }, [activeRoot]);

    // * A late answer for a project that is no longer the open one is dropped.
    const refreshConversations = useCallback(
        (root: string) =>
            void ide
                .chatList(root)
                .then((list) => {
                    if (root === activeRootRef.current) {
                        setConversations(list);
                    }
                })
                .catch(() => undefined),
        [],
    );

    const openPane = (key: string, info: ProjectInfo) =>
        setPanes((current) =>
            current.some((pane) => pane.key === key)
                ? current
                : [...current, { key, root: info.root, name: info.name }],
        );

    useEffect(() => {
        Promise.all([ide.info(), ide.projects()])
            .then(([info, saved]) => {
                setName(info.name);
                setProjects(saved.projects);
                setActiveId(saved.selected);
                openPane(saved.selected ?? STARTUP_KEY, info);
                setView([saved.selected ?? STARTUP_KEY]);
                // * Code is the only view: open the workspace right away.
                setSelected(true);
            })
            .catch((caught) => setError(errorText(caught)));
    }, []);

    useEffect(() => {
        if (activeRoot !== null) {
            refreshConversations(activeRoot);
        }
    }, [activeRoot, refreshConversations]);

    // * A pane already on screen stays where it is (split screen); any other replaces the screen.
    const showAlone = (key: string) =>
        setView((current) => (current.includes(key) ? current : [key]));

    // * The start-up workspace: shown again with a pane of its own when none is open for it.
    const select = () => {
        setSelected(true);
        showAlone(activeKey);

        if (!panes.some((pane) => pane.key === activeKey)) {
            void ide
                .info()
                .then((info) => {
                    setName(info.name);
                    openPane(activeKey, info);
                })
                .catch((caught) => console.error(errorText(caught)));
        }
    };

    const selectProject = (id: string) =>
        ide
            .selectProject(id)
            .then((info) => {
                setName(info.name);
                setActiveId(id);
                openPane(id, info);
                showAlone(id);
                setSelected(true);
            })
            .catch((caught) => console.error(errorText(caught)));

    const createdProject = (project: Project) => {
        // * Adding folders that are already a project hands that project back: only switch to it.
        setProjects((current) =>
            current.some((known) => known.id === project.id)
                ? current
                : [...current, project],
        );
        void selectProject(project.id);
    };

    const removeStartup = () => {
        setStartupHidden(true);
        setPanes((current) =>
            current.filter((pane) => pane.key !== STARTUP_KEY),
        );
        setView((current) => current.filter((key) => key !== STARTUP_KEY));

        if (activeId === null) {
            setSelected(false);
        }
    };

    const removeProject = (id: string) =>
        ide
            .removeProject(id)
            .then(() => {
                setProjects((current) =>
                    current.filter((project) => project.id !== id),
                );
                setPanes((current) =>
                    current.filter((pane) => pane.key !== id),
                );
                setView((current) => current.filter((key) => key !== id));

                if (id === activeId) {
                    setActiveId(null);
                    setSelected(false);
                }
            })
            .catch((caught) => console.error(errorText(caught)));

    return {
        name,
        projects,
        activeId,
        error,
        selected,
        panes,
        view,
        startupHidden,
        conversations,
        activeKey,
        activePane,
        activeRoot,
        refreshConversations,
        select,
        selectProject,
        createdProject,
        removeStartup,
        removeProject,
    };
}
