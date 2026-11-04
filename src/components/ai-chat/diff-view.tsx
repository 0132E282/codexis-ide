import type { DiffRow } from '@/lib/diff-parser';

const ROW_CLASS: Record<DiffRow['kind'], string> = {
    file: 'border-l-2 border-transparent bg-muted px-3 py-0.5 text-[0.7rem] text-muted-foreground',
    hunk: '',
    // * Tint plus a thin left bar so a change never relies on colour alone.
    add: 'border-l-2 border-green-500 bg-green-500/15 px-3',
    del: 'border-l-2 border-red-500 bg-red-500/15 px-3',
    context: 'border-l-2 border-transparent px-3',
    note: 'border-l-2 border-transparent px-3 text-muted-foreground italic opacity-70',
};

/** * GitHub-style unified diff told apart by colour only: green added rows, red removed rows. @@ hunk rows are hidden. Text only, never HTML. */
export function DiffView({ rows }: { rows: DiffRow[] }) {
    return (
        <div className="overflow-x-auto">
            <div className="min-w-max py-1 font-mono text-xs leading-relaxed text-foreground">
                {rows.map((row, index) =>
                    row.kind === 'hunk' ? null : (
                        <div
                            key={index}
                            className={`${ROW_CLASS[row.kind]} whitespace-pre`}
                        >
                            {row.text || ' '}
                        </div>
                    ),
                )}
            </div>
        </div>
    );
}
