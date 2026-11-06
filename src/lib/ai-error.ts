import { isAxiosError } from 'axios';
import { t } from '@/lib/i18n';

/**
 * Text for a failed request: a 429 (Laravel's "Too Many Attempts.") becomes a friendly line, using Retry-After when the server sent it;
 * otherwise the server's own fixed `message`, else `fallback`. The raw error is never shown.
 */
export function requestErrorMessage(caught: unknown, fallback: string): string {
    if (!isAxiosError(caught)) {
        return fallback;
    }

    if (caught.response?.status === 429) {
        const seconds = Number(caught.response.headers?.['retry-after']);

        return Number.isFinite(seconds) && seconds > 0
            ? t('ai_error.you_are_going_too2', {
                  seconds: Math.ceil(seconds),
              })
            : t('ai_error.you_are_going_too');
    }

    return (
        (caught.response?.data as { message?: string } | undefined)?.message ??
        fallback
    );
}

/** * The server's fixed AI error text (`message`); anything else gets a generic line, never the raw error. */
export function aiErrorMessage(caught: unknown): string {
    return requestErrorMessage(caught, t('ai_error.could_not_reach_the'));
}
