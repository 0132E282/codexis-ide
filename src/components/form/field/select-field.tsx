import { Children, isValidElement, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Control } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { useFormRecordId } from '@/components/form/collection-context';
import { InputSelect } from '@/components/ui/input-select';
import type { InputSelectOption } from '@/components/ui/input-select';

export interface SelectFieldProps {
    name: string;
    control?: Control;
    multiple?: boolean;
    placeholder?: string;
    options?: InputSelectOption[];
    /** * Backward compatibility: options from `<option>` children. */
    children?: ReactNode;
    fieldProps?: Record<string, unknown>;
    maxLength?: unknown;
}

function optionsFromChildren(children: ReactNode): InputSelectOption[] {
    return Children.toArray(children)
        .filter(
            (
                child,
            ): child is ReactElement<{
                value?: string;
                children?: ReactNode;
            }> => isValidElement(child),
        )
        .map((child) => ({
            value: String(child.props.value ?? ''),
            label: String(child.props.children ?? ''),
        }));
}

/** * Stored values may be `{value, label}` pairs from `withRelations()` (labels for lazily-loaded lists) or bare ids. */
type SelectValue =
    | string
    | number
    | {
          id?: string | number;
          value?: string | number;
          label?: string;
          name?: string;
          title?: string;
      };

function idOf(entry: SelectValue): string {
    if (typeof entry === 'object' && entry !== null) {
        return String(entry.value ?? entry.id ?? '');
    }

    return String(entry);
}

function labelOptionOf(entry: SelectValue): InputSelectOption | null {
    if (typeof entry === 'object' && entry !== null) {
        const value = String(entry.value ?? entry.id ?? '');

        const label = String(entry.label ?? entry.name ?? entry.title ?? value);

        return { value, label };
    }

    return null;
}

/**
 * * Bound with `useController` (InputSelect isn't a native select).
 * * Options: `options` prop → `<option>` children.
 */
export default function SelectField({
    name,
    control,
    multiple,
    placeholder,
    options,
    children,
    fieldProps,
    maxLength,
}: SelectFieldProps) {
    void fieldProps;
    void maxLength;

    const recordId = useFormRecordId();
    const staticOptions = useMemo(
        () => options ?? (children ? optionsFromChildren(children) : undefined),
        [options, children],
    );

    const baseOptions = useMemo(() => {
        const all = staticOptions ?? [];

        return recordId === undefined
            ? all
            : all.filter((option) => option.value !== String(recordId));
    }, [staticOptions, recordId]);

    const { field } = useController({
        name,
        control,
        defaultValue: multiple ? [] : null,
    });

    if (multiple) {
        const rawValues = (field.value as SelectValue[] | null) ?? [];
        const knownLabels = rawValues
            .map(labelOptionOf)
            .filter((option): option is InputSelectOption => option !== null);
        const seen = new Set(baseOptions.map((option) => option.value));
        const resolvedOptions = [
            ...baseOptions,
            ...knownLabels.filter((option) => !seen.has(option.value)),
        ];

        return (
            <InputSelect
                multiple
                options={resolvedOptions}
                value={rawValues.map(idOf)}
                onChange={field.onChange}
                placeholder={placeholder}
            />
        );
    }

    const rawValue = field.value as SelectValue | null;
    const knownLabel = rawValue !== null ? labelOptionOf(rawValue) : null;
    const resolvedOptions =
        knownLabel &&
        !baseOptions.some((option) => option.value === knownLabel.value)
            ? [...baseOptions, knownLabel]
            : baseOptions;

    return (
        <InputSelect
            options={resolvedOptions}
            value={rawValue !== null ? idOf(rawValue) : null}
            onChange={field.onChange}
            placeholder={placeholder}
        />
    );
}
