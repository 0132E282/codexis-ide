import React from 'react';

export interface TextareaFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    name: string;
    fieldProps?: Record<string, unknown>;
    control?: unknown;
    source?: unknown;
    multiple?: unknown;
}

export default function TextareaField({
    name,
    fieldProps,
    control,
    source,
    multiple,
    ...props
}: TextareaFieldProps) {
    void control;
    void source;
    void multiple;

    return (
        <textarea
            id={name}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
            {...fieldProps}
            {...props}
        />
    );
}
