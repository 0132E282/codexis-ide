import type { Control } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';

export type CheckboxGroupOption = {
    value: number | string;
    label: string;
    description?: string;
};

export interface CheckboxGroupFieldProps {
    name: string;
    control?: Control;
    options?: CheckboxGroupOption[];
    fieldProps?: Record<string, unknown>;
}

/** * Multiple choice stored as an array of the checked option values. */
export default function CheckboxGroupField({
    name,
    control,
    options = [],
    fieldProps,
}: CheckboxGroupFieldProps) {
    void fieldProps;

    const { field } = useController({ name, control, defaultValue: [] });
    const selected: Array<number | string> = Array.isArray(field.value)
        ? field.value
        : [];

    const toggle = (value: number | string, checked: boolean) =>
        field.onChange(
            checked
                ? [...selected, value]
                : selected.filter((entry) => entry !== value),
        );

    return (
        <div className="flex flex-col gap-2">
            {options.map((option) => {
                const id = `${name}-${option.value}`;

                return (
                    <label
                        key={option.value}
                        htmlFor={id}
                        className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
                    >
                        <Checkbox
                            id={id}
                            className="mt-0.5"
                            checked={selected.includes(option.value)}
                            onCheckedChange={(checked) =>
                                toggle(option.value, checked === true)
                            }
                        />
                        <span>
                            <span className="block text-sm font-medium">
                                {option.label}
                            </span>
                            {option.description && (
                                <span className="block text-xs text-muted-foreground">
                                    {option.description}
                                </span>
                            )}
                        </span>
                    </label>
                );
            })}
        </div>
    );
}
