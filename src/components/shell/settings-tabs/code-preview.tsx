import { CODE_PALETTES, type CodePalette } from '@/lib/code-palettes';
import { resolveCodeScheme, useThemeState } from '@/lib/system-theme';

type Kind = keyof Pick<
    CodePalette,
    | 'comment'
    | 'keyword'
    | 'control'
    | 'function'
    | 'regexp'
    | 'string'
    | 'number'
    | 'type'
    | 'variable'
>;

// * A short sample, split into the kinds of token the editor colors differently.
const SAMPLE: { kind?: Kind; text: string }[][] = [
    [{ kind: 'comment', text: '// Chào bạn' }],
    [
        { kind: 'keyword', text: 'const ' },
        { kind: 'function', text: 'greet' },
        { text: ' = (' },
        { kind: 'variable', text: 'name' },
        { text: ': ' },
        { kind: 'type', text: 'string' },
        { text: ') => {' },
    ],
    [
        { kind: 'control', text: '    return ' },
        { kind: 'string', text: "'Xin chào, '" },
        { text: ' + ' },
        { kind: 'variable', text: 'name' },
        { text: ' + ' },
        { kind: 'number', text: '42' },
        { text: ';' },
    ],
    [{ text: '};' }],
    [
        { kind: 'keyword', text: 'const ' },
        { kind: 'variable', text: 'digits' },
        { text: ' = ' },
        { kind: 'regexp', text: '/\\d+/g' },
        { text: ';' },
    ],
];

/** Sample code in the code colors that are chosen now, so a choice can be judged before it is kept. */
export function CodePreview() {
    // * Read again when the look or the code colors change.
    useThemeState();

    const palette = CODE_PALETTES[resolveCodeScheme()];

    return (
        <pre
            aria-hidden="true"
            className="h-full overflow-x-auto rounded-md border bg-card p-3 font-mono text-xs leading-5"
        >
            {SAMPLE.map((line, row) => (
                <div key={row}>
                    {line.map((part, column) => (
                        <span
                            key={column}
                            style={
                                part.kind === undefined
                                    ? undefined
                                    : { color: palette[part.kind] }
                            }
                        >
                            {part.text}
                        </span>
                    ))}
                </div>
            ))}
        </pre>
    );
}
