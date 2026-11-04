import type { Control, FieldValues } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from '@/components/ui/input-otp';

export interface OtpFieldProps {
    name: string;
    maxLength: number;
    control?: Control<FieldValues>;
    fieldProps?: Record<string, unknown>;
}

export default function OtpField({
    name,
    maxLength,
    control,
    fieldProps,
}: OtpFieldProps) {
    if (control) {
        return (
            <Controller
                name={name}
                control={control}
                render={({ field }) => (
                    <InputOTP
                        id={name}
                        maxLength={maxLength}
                        containerClassName="w-full justify-center"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                    >
                        <InputOTPGroup>
                            {Array.from({ length: maxLength }).map(
                                (_, index) => (
                                    <InputOTPSlot
                                        key={index}
                                        index={index}
                                        className="h-12 w-12 text-lg"
                                    />
                                ),
                            )}
                        </InputOTPGroup>
                    </InputOTP>
                )}
            />
        );
    }

    return (
        <InputOTP
            id={name}
            maxLength={maxLength}
            containerClassName="w-full justify-center"
            {...fieldProps}
        >
            <InputOTPGroup>
                {Array.from({ length: maxLength }).map((_, index) => (
                    <InputOTPSlot
                        key={index}
                        index={index}
                        className="h-12 w-12 text-lg"
                    />
                ))}
            </InputOTPGroup>
        </InputOTP>
    );
}
