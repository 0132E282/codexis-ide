import { ideTools, type RuleFile } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<RuleFile>[] = [
    {
        header: 'Tên',
        cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    { header: 'Nội dung đầu', grow: true, cell: (row) => row.excerpt || '—' },
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
const name = (row: RuleFile) => row.name;

/** Settings tab "Rules": read-only list of rule files of the open project and this machine. */
export function RulesTab() {
    return (
        <ToolTable
            load={ideTools.rules}
            columns={columns}
            name={name}
            emptyText="Chưa có tệp rules nào."
        />
    );
}
