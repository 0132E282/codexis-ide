import React from 'react';
import { Input } from '@/components/ui/input';

export interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    name: string;
    fieldProps?: Record<string, unknown>;
    control?: unknown;
    source?: unknown;
}

export default function InputField({
    name,
    fieldProps,
    control,
    source,
    ...props
}: InputFieldProps) {
    void control;
    void source;

    return <Input id={name} {...fieldProps} {...props} />;
}
