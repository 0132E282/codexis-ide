import type { AnyExtension, Editor } from '@tiptap/react';
import type { ComponentType } from 'react';

/** * `extensions` are registered on the editor; `Toolbar` renders in the toolbar row. */
export type EditorPlugin = {
    name: string;
    extensions?: AnyExtension[];
    Toolbar?: ComponentType<{ editor: Editor }>;
};
