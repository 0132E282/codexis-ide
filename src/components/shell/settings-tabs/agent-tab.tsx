import { ideTools, type ToolEntry } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<ToolEntry>[] = [
    {
        header: 'Tên',
        cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    { header: 'Mô tả', grow: true, cell: (row) => row.description || '—' },
    { header: 'Model', cell: (row) => row.model ?? '—' },
    { header: 'Công cụ', cell: (row) => row.tools ?? '—' },
    {
        header: 'Nguồn',
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
            emptyText="Chưa có agent nào được cấu hình."
        />
    );
}
