import { ideTools, type ToolEntry } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<ToolEntry>[] = [
    {
        header: 'common.name',
        cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
        header: 'common.description',
        grow: true,
        cell: (row) => row.description || '—',
    },
    { header: 'Model', cell: (row) => row.model ?? '—' },
    { header: 'agent_tab.tools', cell: (row) => row.tools ?? '—' },
    {
        header: 'common.source',
        clamp: false,
        cell: (row, detail) => (
            <SourceCell
                compact={!detail}
                scope={row.scope}
                path={row.path}
                relativePath={row.relativePath}
            />
        ),
    },
];
const name = (row: ToolEntry) => row.name;

/** Settings tab "Agent": read-only table of the agents of the open project and this machine. */
export function AgentTab() {
    return (
        <ToolTable
            load={ideTools.agents}
            columns={columns}
            name={name}
            emptyText={'agent_tab.no_agents_configured_yet'}
        />
    );
}
