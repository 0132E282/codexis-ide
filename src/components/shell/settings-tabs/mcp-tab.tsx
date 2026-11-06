import { ideTools, type McpServer } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<McpServer>[] = [
    {
        header: 'common.name',
        cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    { header: 'common.type', cell: (row) => row.kind },
    {
        header: 'mcp_tab.command_url',
        grow: true,
        cell: (row) => (
            <span className="break-all font-mono text-xs">
                {row.target || '—'}
            </span>
        ),
    },
    {
        header: 'common.source',
        clamp: false,
        cell: (row, detail) => (
            <SourceCell compact={!detail} scope={row.scope} path={row.path} />
        ),
    },
];
const name = (row: McpServer) => row.name;

/** Settings tab "MCP": read-only list of MCP servers (name, type, command only; env and headers are never shown). */
export function McpTab() {
    return (
        <ToolTable
            load={ideTools.mcp}
            columns={columns}
            name={name}
            emptyText={'mcp_tab.no_mcp_servers_configured'}
        />
    );
}
