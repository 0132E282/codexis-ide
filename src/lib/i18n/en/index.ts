import { appUpdateEnglish } from './app-update';
import { aiChatEnglish } from './ai-chat';
import { codeViewerEnglish } from './code-viewer';
import { sessionRailEnglish } from './session-rail';
import { shellChatEnglish } from './shell-chat';
import { shellMainEnglish } from './shell-main';
import { shellSettingsEnglish } from './shell-settings';
import { uiLibEnglish } from './ui-lib';

/** Every English text of the interface, by its Vietnamese text. */
export const english: Record<string, string> = {
    ...shellMainEnglish,
    ...shellSettingsEnglish,
    ...shellChatEnglish,
    ...aiChatEnglish,
    ...codeViewerEnglish,
    ...uiLibEnglish,
    ...sessionRailEnglish,
    ...appUpdateEnglish,
};
