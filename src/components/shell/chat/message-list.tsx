import { forwardRef } from 'react';
import logo from '@/assets/logo.png';
import { SubagentView } from '@/components/shell/chat/subagent-view';
import { AttachmentView } from '@/components/shell/chat/attachment-view';
import { splitPrompt } from '@/components/shell/chat/turn';
import type { PermissionRequest, Turn } from '@/components/shell/chat/turn';
import { TurnView } from '@/components/shell/chat/turn-view';
import { t } from '@/lib/i18n';

/** The conversation, or what one sub-agent did when `viewSubagent` is set. The ref points at the end of the list, to scroll to. */
export const MessageList = forwardRef<
    HTMLDivElement,
    {
        turns: Turn[];
        viewSubagent: string | null;
        onLeaveSubagent: () => void;
        /** Stable between renders: the memoised turns depend on it. */
        onChoose: (text: string) => void;
        /** The pending choice card is shown in a popup above the message box, not in the thread. */
        choicesInPopup?: boolean;
        /** Stable between renders: sends a turn that hit a limit again under another account. */
        onSwitchAccount: (turn: Turn) => void;
        /** Stable between renders: answers a question of the AI (allow or deny). */
        onPermission: (
            turn: Turn,
            request: PermissionRequest,
            allow: boolean,
        ) => void;
        /** Name of the project, shown on the card of the files a turn changed. */
        projectName: string;
        /** Messages sent while a turn runs: shown at the end at once, as sent but not answered yet. */
        waiting?: string[];
    }
>(function MessageList(
    {
        turns,
        viewSubagent,
        onLeaveSubagent,
        onChoose,
        choicesInPopup = false,
        onSwitchAccount,
        onPermission,
        projectName,
        waiting = [],
    },
    bottom,
) {
    return (
        <div
            data-chat-scroll
            // * As tall as its messages (it shrinks and scrolls when they are many): a short chat keeps the message box right under it instead of pushing it to the bottom.
            className="min-h-0 flex-initial overflow-x-hidden overflow-y-auto overscroll-contain p-4"
        >
            {/* * One centred column, as wide as the message box: a wide panel keeps lines readable instead of pushing the two sides apart. */}
            <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6">
                {turns.length === 0 && (
                    <div className="flex flex-col items-center gap-3 pt-[20vh] text-center">
                        <img src={logo} alt="" className="size-12" />
                        <p className="text-sm text-muted-foreground">
                            {t('message_list.send_amessage_to')}
                        </p>
                    </div>
                )}
                {viewSubagent !== null ? (
                    <SubagentView
                        id={viewSubagent}
                        turns={turns}
                        onBack={onLeaveSubagent}
                    />
                ) : (
                    <>
                        {turns.map((turn, index) => (
                            <TurnView
                                key={turn.id}
                                turn={turn}
                                interactive={
                                    index === turns.length - 1 && !turn.running
                                }
                                followUp={turns[index + 1]?.prompt ?? null}
                                onChoose={onChoose}
                                choicesInPopup={choicesInPopup}
                                onSwitchAccount={onSwitchAccount}
                                onPermission={onPermission}
                                projectName={projectName}
                            />
                        ))}
                        {waiting.map((prompt, index) => {
                            const { text, files } = splitPrompt(prompt);

                            return (
                                <div
                                    key={`${index}-${prompt}`}
                                    className="ml-auto flex w-fit max-w-[85%] min-w-0 flex-col items-end gap-1"
                                >
                                    {files.length > 0 && (
                                        <ul className="flex flex-wrap justify-end gap-2 opacity-70">
                                            {files.map((file) => (
                                                <li key={file.path}>
                                                    <AttachmentView
                                                        path={file.path}
                                                        name={file.name}
                                                    />
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {text !== '' && (
                                        <p className="max-h-80 max-w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-2xl bg-muted px-4 py-2.5 whitespace-pre-wrap opacity-70 [overflow-wrap:anywhere]">
                                            {text}
                                        </p>
                                    )}
                                    <span className="text-xs text-muted-foreground">
                                        {t('message_list.waiting')}
                                    </span>
                                </div>
                            );
                        })}
                    </>
                )}
                <div ref={bottom} />
            </div>
        </div>
    );
});
