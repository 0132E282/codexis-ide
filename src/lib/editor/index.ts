/** * One file per plugin conforming to `EditorPlugin`; register it in `PLUGINS` (plugins.ts). */
export type { EditorPlugin } from './plugin';
export { PLUGINS } from './plugins';

export { CalloutNode } from './callout-node';
export { ImageBubbleMenu } from './image';
export type { ImageAlign } from './image';
export { getSource, MarkdownExtension } from './markdown';
