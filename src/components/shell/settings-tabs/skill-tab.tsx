import { ideTools, type ToolEntry } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<ToolEntry>[] = [
    {
        header: 'Tên',
        cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    { header: 'Mô tả', grow: true, cell: (row) => row.description || '—' },
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

/** Settings tab "Skill": read-only list of the skills of the open project and this machine. */
export function SkillTab() {
    return (
        <ToolTable
            load={ideTools.skills}
            columns={columns}
            name={name}
            emptyText="Chưa có skill nào được cấu hình."
        />
    );
}
