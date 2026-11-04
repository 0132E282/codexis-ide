import { ideTools, type HookEntry } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<HookEntry>[] = [
    {
        header: 'Sự kiện',
        cell: (row) => <span className="font-medium">{row.event}</span>,
    },
    { header: 'Matcher', cell: (row) => row.matcher },
    { header: 'Loại', cell: (row) => row.kind },
    {
        header: 'Lệnh',
        grow: true,
        cell: (row) => (
            <span className="break-all font-mono text-xs">
                {row.command || '—'}
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
const name = (row: HookEntry) => row.event;

/** Settings tab "Hook": read-only list of the hooks of the open project and this machine. */
export function HookTab() {
    return (
        <ToolTable
            load={ideTools.hooks}
            columns={columns}
            name={name}
            emptyText="Chưa có hook nào được cấu hình."
        />
    );
}
