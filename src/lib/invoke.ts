import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { translateError } from '@/lib/i18n';

/** `invoke` of Tauri whose failures (a fixed key from the backend) are already in the language of the interface. */
export async function invoke<T>(
    ...parameters: Parameters<typeof tauriInvoke>
): Promise<T> {
    try {
        return await tauriInvoke<T>(...parameters);
    } catch (caught) {
        throw typeof caught === 'string' ? translateError(caught) : caught;
    }
}
