import React from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { FormProvider } from 'react-hook-form';
import { FieldGroup } from '@/components/ui/field';
import type { FieldProps } from './field';
import Field from './field';

interface FormProps<
    T extends FieldValues,
> extends React.FormHTMLAttributes<HTMLFormElement> {
    form: UseFormReturn<T>;
    onSubmit?: React.FormEventHandler<HTMLFormElement>;
    children: React.ReactNode;
    withFieldGroup?: boolean;
}

export function Form<T extends FieldValues>({
    form,
    onSubmit,
    children,
    className,
    withFieldGroup = true,
    ...props
}: FormProps<T>) {
    return (
        <FormProvider {...form}>
            <form onSubmit={onSubmit} className={className} {...props}>
                {withFieldGroup ? (
                    <FieldGroup>{children}</FieldGroup>
                ) : (
                    children
                )}
            </form>
        </FormProvider>
    );
}

export type { FieldProps };
export { Field };
