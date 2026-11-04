import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { Resolver, UseFormProps, FieldValues } from 'react-hook-form';
import { z } from 'zod';

interface UseAppFormProps<T extends FieldValues> extends Omit<
    UseFormProps<T>,
    'resolver'
> {
    schema?: z.ZodType<T>;
}

export function useAppForm<T extends FieldValues>({
    schema,
    ...props
}: UseAppFormProps<T> = {}) {
    // ! zod v4's internal types don't line up with @hookform/resolvers' generic constraints yet; the resolver is sound at runtime.
    const form = useForm<T>({
        ...(schema && {
            resolver: zodResolver(schema) as unknown as Resolver<T>,
        }),
        ...props,
    });

    return form;
}

export { z };
