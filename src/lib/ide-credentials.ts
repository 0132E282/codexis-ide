import { invoke } from '@tauri-apps/api/core';

export type CredentialName = 'anthropic_api_key';

/** Whether a saved key is set. The key itself never comes back, only its last characters. */
export type CredentialStatus = {
    name: CredentialName;
    set: boolean;
    hint: string | null;
};

export const ideCredentials = {
    status: () => invoke<CredentialStatus[]>('credential_status'),
    save: (name: CredentialName, value: string) =>
        invoke<CredentialStatus[]>('credential_save', { name, value }),
    remove: (name: CredentialName) =>
        invoke<CredentialStatus[]>('credential_remove', { name }),
};
