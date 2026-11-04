import { useState } from 'react';
import { cn } from '@/lib/utils';

const GRID_SIZE = 8;

/** * Google Docs-style grid picker; the inputs cover sizes beyond the grid. */
export function TableSizePicker({
    onPick,
}: {
    onPick: (rows: number, cols: number) => void;
}) {
    const [hover, setHover] = useState({ row: 0, col: 0 });
    const [customRows, setCustomRows] = useState(3);
    const [customCols, setCustomCols] = useState(3);

    return (
        <div className="w-fit p-2">
            <p className="text-muted-foreground mb-1.5 text-xs">
                {hover.row + 1} x {hover.col + 1}
            </p>
            <div
                className="grid gap-0.5"
                style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1rem)` }}
                onMouseLeave={() => setHover({ row: 0, col: 0 })}
            >
                {Array.from({ length: GRID_SIZE * GRID_SIZE }).map(
                    (_, index) => {
                        const row = Math.floor(index / GRID_SIZE);
                        const col = index % GRID_SIZE;
                        const active = row <= hover.row && col <= hover.col;

                        return (
                            <button
                                key={index}
                                type="button"
                                onMouseEnter={() => setHover({ row, col })}
                                onClick={() => onPick(row + 1, col + 1)}
                                className={cn(
                                    'border-input size-4 rounded-[2px] border',
                                    active && 'border-primary bg-primary/40',
                                )}
                            />
                        );
                    },
                )}
            </div>

            <div className="mt-2 flex items-center justify-center gap-1 border-t pt-2">
                <input
                    type="number"
                    min={1}
                    value={customRows}
                    onChange={(event) =>
                        setCustomRows(Math.max(1, Number(event.target.value)))
                    }
                    className="border-input h-6 w-9 rounded border bg-transparent px-1 text-center text-xs"
                />
                <span className="text-muted-foreground text-xs">×</span>
                <input
                    type="number"
                    min={1}
                    value={customCols}
                    onChange={(event) =>
                        setCustomCols(Math.max(1, Number(event.target.value)))
                    }
                    className="border-input h-6 w-9 rounded border bg-transparent px-1 text-center text-xs"
                />
                <button
                    type="button"
                    className="text-primary hover:bg-accent ml-1 rounded-md px-1.5 py-0.5 text-xs"
                    onClick={() => onPick(customRows, customCols)}
                >
                    Chèn
                </button>
            </div>
        </div>
    );
}
