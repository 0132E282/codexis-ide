import { aiChatVietnamese } from './ai-chat';
import { codeViewerVietnamese } from './code-viewer';
import { shellChatVietnamese } from './shell-chat';
import { shellMainVietnamese } from './shell-main';
import { shellSettingsVietnamese } from './shell-settings';
import { uiLibVietnamese } from './ui-lib';

/** Every Vietnamese text of the interface, by key. */
export const vietnamese: Record<string, string> = {
    ...shellMainVietnamese,
    ...shellSettingsVietnamese,
    ...shellChatVietnamese,
    ...aiChatVietnamese,
    ...codeViewerVietnamese,
    ...uiLibVietnamese,
};
