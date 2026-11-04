import { ideTools, type McpServer } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<McpServer>[] = [
    {
        header: 'Tên',
        cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    { header: 'Loại', cell: (row) => row.kind },
    {
        header: 'Lệnh / URL',
        grow: true,
        cell: (row) => (
            <span className="break-all font-mono text-xs">
                {row.target || '—'}
            </span>
        ),
    },
    {
        header: 'Nguồn',
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
            emptyText="Chưa có MCP server nào được cấu hình."
        />
    );
}
