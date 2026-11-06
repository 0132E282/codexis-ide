import { forwardRef } from 'react';
import logo from '@/assets/logo.png';
import { SubagentView } from '@/components/shell/chat/subagent-view';
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
        /** Stable between renders: sends a turn that hit a limit again under another account. */
        onSwitchAccount: (turn: Turn) => void;
        /** Stable between renders: answers a question of the AI (allow or deny). */
        onPermission: (
            turn: Turn,
            request: PermissionRequest,
            allow: boolean,
        ) => void;
    }
>(function MessageList(
    {
        turns,
        viewSubagent,
        onLeaveSubagent,
        onChoose,
        onSwitchAccount,
        onPermission,
    },
    bottom,
) {
    return (
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
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
                                onSwitchAccount={onSwitchAccount}
                                onPermission={onPermission}
                            />
                        ))}
                    </>
                )}
                <div ref={bottom} />
            </div>
        </div>
    );
});
