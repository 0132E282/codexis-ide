import { ideTools, type HookEntry } from '@/lib/ide-tools';
import { SourceCell, ToolTable, type ToolColumn } from './tool-table';

const columns: ToolColumn<HookEntry>[] = [
    {
        header: 'hook_tab.event',
        cell: (row) => <span className="font-medium">{row.event}</span>,
    },
    { header: 'Matcher', cell: (row) => row.matcher },
    { header: 'common.type', cell: (row) => row.kind },
    {
        header: 'common.command',
        grow: true,
        cell: (row) => (
            <span className="break-all font-mono text-xs">
                {row.command || '—'}
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
const name = (row: HookEntry) => row.event;

/** Settings tab "Hook": read-only list of the hooks of the open project and this machine. */
export function HookTab() {
    return (
        <ToolTable
            load={ideTools.hooks}
            columns={columns}
            name={name}
            emptyText={'hook_tab.no_hooks_configured_yet'}
        />
    );
}
