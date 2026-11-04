import type { Control } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { Switch } from '@/components/ui/switch';

export interface SwitchFieldProps {
    name: string;
    control?: Control;
    fieldProps?: Record<string, unknown>;
}

export default function SwitchField({
    name,
    control,
    fieldProps,
}: SwitchFieldProps) {
    void fieldProps;

    const { field } = useController({ name, control, defaultValue: false });

    if (!control) {
        return null;
    }

    return (
        <Switch
            id={name}
            checked={!!field.value}
            onCheckedChange={field.onChange}
        />
    );
}
