import React from 'react';
import { useFormContext } from 'react-hook-form';
import { Field as BaseField, FieldLabel } from '@/components/ui/field';
import type { InputSelectOption } from '@/components/ui/input-select';
import { cn } from '@/lib/utils';
import AttachmentField from './attachment-field';
import AutoSyncField from './auto-sync-field';
import CheckboxGroupField from './checkbox-group-field';
import type { CheckboxGroupOption } from './checkbox-group-field';
import ChoiceCardsField from './choice-cards-field';
import type { ChoiceCardOption } from './choice-cards-field';
import EditorField from './editor-field';
import InputField from './input-field';
import OtpField from './otp-field';
import type { RepeaterColumn } from './repeater-field';
import RepeaterField from './repeater-field';
import SelectField from './select-field';
import SwitchField from './switch-field';
import TextareaField from './textarea-field';

export interface FieldProps extends React.InputHTMLAttributes<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
> {
    name: string;
    ui?:
        | 'input'
        | 'textarea'
        | 'select'
        | 'checkbox'
        | 'switch'
        | 'otp'
        | 'attachment'
        | 'editor'
        | 'repeater'
        | 'auto-sync'
        | 'choice-cards'
        | 'checkbox-group';
    label?: string;
    description?: string;
    registerFn?: any;
    errorMsg?: string;
    maxLength?: number;
    multiple?: boolean;
    /** * `ui="select"`: explicit options. */
    options?: InputSelectOption[] | ChoiceCardOption[] | CheckboxGroupOption[];
    fields?: RepeaterColumn[];
    addLabel?: string;
    /** * `ui="repeater"`: columns hidden from the inline table (still in the row-detail popup). */
    views?: string[];
    /** * FormLayout shorthand: 'required:msg' | 'min:3:msg' | 'max:255:msg' | 'email:msg'. */
    validate?: string;
    /** * Read by FormLayout when deriving defaultValues from children. */
    default?: unknown;
    showError?: boolean;
}

const FIELD_COMPONENTS: Record<
    NonNullable<FieldProps['ui']>,
    React.ComponentType<any>
> = {
    input: InputField,
    checkbox: InputField,
    switch: SwitchField,
    textarea: TextareaField,
    select: SelectField,
    otp: OtpField,
    attachment: AttachmentField,
    editor: EditorField,
    repeater: RepeaterField,
    'auto-sync': AutoSyncField,
    'choice-cards': ChoiceCardsField,
    'checkbox-group': CheckboxGroupField,
};

export default function Field({
    name,
    ui = 'input',
    label,
    description,
    className,
    registerFn,
    errorMsg,
    maxLength,
    validate,
    default: defaultVal,
    autoComplete = name,
    showError = true,
    ...props
}: FieldProps) {
    void defaultVal; // * read by FormLayout, see `default`

    const context = useFormContext();
    const register = registerFn || context?.register;
    const errors = context?.formState?.errors;

    const error =
        errorMsg || (errors && (errors[name]?.message as string | undefined));

    const renderUI = () => {
        const fieldProps = register ? register(name) : {};
        const Component = FIELD_COMPONENTS[ui] ?? InputField;

        return (
            <Component
                name={name}
                fieldProps={fieldProps}
                maxLength={maxLength}
                autoComplete={autoComplete}
                control={context?.control}
                aria-invalid={!!error}
                {...props}
            />
        );
    };

    // * Switch/checkbox use a compact row (control left, label right); BaseField's horizontal layout leaves a wide gap.
    if (ui === 'switch' || ui === 'checkbox') {
        return (
            <BaseField
                className={cn('w-fit flex-row items-center gap-2', className)}
            >
                {renderUI()}
                {label && <FieldLabel htmlFor={name}>{label}</FieldLabel>}
                {description && !error && (
                    <p className="text-[0.8rem] text-muted-foreground">
                        {description}
                    </p>
                )}
                {error && showError && (
                    <p className="animate-in text-[0.8rem] font-medium text-destructive fade-in">
                        {error}
                    </p>
                )}
            </BaseField>
        );
    }

    return (
        <BaseField className={className}>
            {label && <FieldLabel htmlFor={name}>{label}</FieldLabel>}
            {renderUI()}
            {description && !error && (
                <p className="mt-1 text-[0.8rem] text-muted-foreground">
                    {description}
                </p>
            )}
            {error && showError && (
                <p className="mt-1 animate-in text-[0.8rem] font-medium text-destructive fade-in">
                    {error}
                </p>
            )}
        </BaseField>
    );
}
