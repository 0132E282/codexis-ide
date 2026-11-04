import type { AnyExtension, Editor } from '@tiptap/react';
import type { ReactNode } from 'react';
import type { Control } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { RichTextEditor } from '@/components/ui/rich-text-editor';

export interface EditorFieldProps {
    name: string;
    control?: Control;
    placeholder?: string;
    extensions?: AnyExtension[];
    renderToolbar?: (editor: Editor) => ReactNode;
    fieldProps?: Record<string, unknown>;
    maxLength?: unknown;
    source?: unknown;
    multiple?: unknown;
}

/** * Bound with `useController`: Tiptap isn't a native input, so `register(name)` can't bind it. */
export default function EditorField({
    name,
    control,
    placeholder,
    extensions,
    renderToolbar,
    fieldProps,
    maxLength,
    source,
    multiple,
}: EditorFieldProps) {
    void fieldProps;
    void maxLength;
    void source;
    void multiple;

    const { field } = useController({ name, control, defaultValue: '' });

    return (
        <RichTextEditor
            value={(field.value as string | null) ?? ''}
            onChange={field.onChange}
            placeholder={placeholder}
            extensions={extensions}
            renderToolbar={renderToolbar}
        />
    );
}
