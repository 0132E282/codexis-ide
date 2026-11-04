import { invoke } from '@tauri-apps/api/core';
import { ide } from '@/lib/ide';

export type ToolScope = 'project' | 'machine';
export type ToolListing<T> = { items: T[]; warnings: string[] };
/** A skill or an agent. `relativePath` is set for project entries only. */
export type ToolEntry = {
    name: string;
    description: string;
    model: string | null;
    tools: string | null;
    scope: ToolScope;
    path: string;
    relativePath: string | null;
};
export type McpServer = {
    name: string;
    kind: string;
    target: string;
    scope: ToolScope;
    path: string;
};
export type RuleFile = {
    name: string;
    excerpt: string;
    scope: ToolScope;
    path: string;
    relativePath: string | null;
};
export type HookEntry = {
    event: string;
    matcher: string;
    kind: string;
    command: string;
    scope: ToolScope;
    path: string;
};

/** Folder of the open project, or null when the open folder is not a saved project (only the machine is listed then). */
async function projectRoot(): Promise<string | null> {
    const { projects, selected } = await ide.projects();

    return (
        projects.find((project) => project.id === selected)?.folders[0] ?? null
    );
}

async function list<T>(command: string): Promise<ToolListing<T>> {
    return invoke<ToolListing<T>>(command, {
        projectRoot: await projectRoot(),
    });
}

export const ideTools = {
    skills: () => list<ToolEntry>('tools_skills'),
    agents: () => list<ToolEntry>('tools_agents'),
    mcp: () => list<McpServer>('tools_mcp'),
    rules: () => list<RuleFile>('tools_rules'),
    hooks: () => list<HookEntry>('tools_hooks'),
};
