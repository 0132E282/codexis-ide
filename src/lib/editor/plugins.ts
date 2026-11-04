import { AlignToolbar, TextAlign } from './align';
import { BlockquoteToolbar } from './blockquote';
import { CodeBlockToolbar } from './code-block';
import { HeadingToolbar } from './heading';
import { HighlightToolbar, Highlight } from './highlight';
import { HorizontalRuleToolbar } from './horizontal-rule';
import { Image, ImageToolbar } from './image';
import { LineHeight, LineHeightToolbar } from './line-height';
import { LinkExtension, LinkToolbar } from './link';
import { MarksToolbar } from './marks';
import { OrderedListExtended, OrderedListToolbar } from './ordered-list';
import type { EditorPlugin } from './plugin';
import { RemoveFormatToolbar } from './remove-format';
import { TableExtension, TableToolbar } from './table';
import { TextColorToolbar } from './text-color';
import { TextStyleExtended, TextStyleToolbar } from './text-style';
import { VideoEmbed, VideoToolbar } from './video-embed';

/** * Default toolbar in display order; MarkdownExtension and ImageBubbleMenu are wired in rich-text-editor.tsx instead. */
export const PLUGINS: EditorPlugin[] = [
    { name: 'heading', Toolbar: HeadingToolbar },
    {
        name: 'textStyle',
        extensions: [TextStyleExtended],
        Toolbar: TextStyleToolbar,
    },
    {
        name: 'lineHeight',
        extensions: [LineHeight],
        Toolbar: LineHeightToolbar,
    },
    { name: 'marks', Toolbar: MarksToolbar },
    {
        name: 'orderedList',
        extensions: [OrderedListExtended],
        Toolbar: OrderedListToolbar,
    },
    { name: 'link', extensions: [LinkExtension], Toolbar: LinkToolbar },
    { name: 'blockquote', Toolbar: BlockquoteToolbar },
    { name: 'codeBlock', Toolbar: CodeBlockToolbar },
    { name: 'horizontalRule', Toolbar: HorizontalRuleToolbar },
    { name: 'align', extensions: [TextAlign], Toolbar: AlignToolbar },
    { name: 'textColor', Toolbar: TextColorToolbar },
    { name: 'highlight', extensions: [Highlight], Toolbar: HighlightToolbar },
    { name: 'image', extensions: [Image], Toolbar: ImageToolbar },
    { name: 'video', extensions: [VideoEmbed], Toolbar: VideoToolbar },
    { name: 'table', extensions: [TableExtension], Toolbar: TableToolbar },
    { name: 'removeFormat', Toolbar: RemoveFormatToolbar },
];
