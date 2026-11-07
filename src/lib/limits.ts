/**
 * Input limits of the interface, matching `src-tauri/src/validation.rs` (the backend stays the judge).
 * `maxLength` counts UTF-16 units while some backend limits count bytes, so these only stop the obvious overflow early.
 */

/** Longest file, folder or project name (backend: 255 bytes). */
export const ENTRY_NAME_MAX_LENGTH = 255;
/** Longest display name of a project (backend: 100 characters). */
export const DISPLAY_NAME_MAX_LENGTH = 100;
/** Longest commit title shown in the commit box. */
export const COMMIT_TITLE_MAX_LENGTH = 100;
/** Longest commit message (backend: 10,000 characters). */
export const COMMIT_MESSAGE_MAX_LENGTH = 10_000;
/** Longest question put to the AI about a piece of code (backend: 20,000 characters). */
export const INLINE_QUESTION_MAX_LENGTH = 20_000;
/** Longest prompt of a chat turn (backend: 200,000 bytes). */
export const CHAT_PROMPT_MAX_LENGTH = 200_000;
/** Longest API key (backend: 500). */
export const API_KEY_MAX_LENGTH = 500;
/** Longest custom instructions (backend: 8,000 characters). */
export const INSTRUCTIONS_MAX_LENGTH = 8000;
/** Longest environment variable name. */
export const ENV_KEY_MAX_LENGTH = 255;
/** Longest environment variable value. */
export const ENV_VALUE_MAX_LENGTH = 4096;

/** Whether a file or folder name has a character the backend refuses (a path separator). */
export function hasPathSeparator(name: string): boolean {
    return name.includes('/') || name.includes('\\');
}
