import { useEffect, useRef, useState } from 'react';
import type { Control } from 'react-hook-form';
import { useController, useWatch } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

export interface AutoSyncFieldProps {
    name: string;
    control?: Control;
    /** * Field to copy from while the toggle is on; defaults to `name`. */
    source?: string;
    transform?: (value: string) => string;
    syncLabel?: string;
    fieldProps?: Record<string, unknown>;
}

/** * `SlugField`'s auto-fill pattern for non-slug fields (e.g. SEO title from name); typing turns it off. */
export default function AutoSyncField({
    name,
    control,
    source = 'name',
    transform = (value) => value,
    syncLabel = t('auto_sync_field.auto_sync'),
}: AutoSyncFieldProps) {
    const { field } = useController({ name, control, defaultValue: '' });
    const sourceValue = useWatch({ control, name: source }) as unknown;
    const currentValue = (field.value as string | undefined) ?? '';
    const [auto, setAuto] = useState(true);
    const isInitialized = useRef(false);

    useEffect(() => {
        // * `source` is briefly empty before the initial `reset()`; wait instead of treating it as a change.
        if (typeof sourceValue !== 'string' || !sourceValue) {
            return;
        }

        // ! Decided once on first real data: a saved value that differs from the derived one was edited by hand — don't overwrite it.
        if (!isInitialized.current) {
            isInitialized.current = true;
            setAuto(
                currentValue === '' || currentValue === transform(sourceValue),
            );

            return;
        }

        if (auto) {
            field.onChange(transform(sourceValue));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the watched source value (or the toggle) changes
    }, [sourceValue, auto]);

    if (!control) {
        return null;
    }

    return (
        <div className="relative">
            <Input
                id={name}
                value={currentValue}
                onChange={(event) => {
                    setAuto(false);
                    field.onChange(event.target.value);
                }}
                onBlur={field.onBlur}
                className="pr-9"
            />
            <Checkbox
                checked={auto}
                onCheckedChange={(checked) => setAuto(!!checked)}
                title={syncLabel}
                className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
            />
        </div>
    );
}
