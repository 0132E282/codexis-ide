import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export const FONT_SIZES = [
    '12px',
    '14px',
    '16px',
    '18px',
    '20px',
    '24px',
    '32px',
];

export const FONT_FAMILIES = [
    { label: 'Mặc định', value: '' },
    { label: 'Sans-serif', value: 'ui-sans-serif, system-ui, sans-serif' },
    { label: 'Serif', value: 'ui-serif, Georgia, serif' },
    { label: 'Monospace', value: 'ui-monospace, monospace' },
    { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
];

export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2', '2.5'];

export const SWATCH_COLORS = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#000000',
];

export const ALIGN_OPTIONS = [
    { value: 'left', label: 'Căn trái', icon: AlignLeft },
    { value: 'center', label: 'Căn giữa', icon: AlignCenter },
    { value: 'right', label: 'Căn phải', icon: AlignRight },
    { value: 'justify', label: 'Căn đều', icon: AlignJustify },
] as const;
