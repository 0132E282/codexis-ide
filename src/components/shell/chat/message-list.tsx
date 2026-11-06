import { forwardRef } from 'react';
import logo from '@/assets/logo.png';
import { SubagentView } from '@/components/shell/chat/subagent-view';
import type { Turn } from '@/components/shell/chat/turn';
import { TurnView } from '@/components/shell/chat/turn-view';

/** The conversation, or what one sub-agent did when `viewSubagent` is set. The ref points at the end of the list, to scroll to. */
export const MessageList = forwardRef<
    HTMLDivElement,
    {
        turns: Turn[];
        viewSubagent: string | null;
        onLeaveSubagent: () => void;
        /** Stable between renders: the memoised turns depend on it. */
        onChoose: (text: string) => void;
    }
>(function MessageList(
    { turns, viewSubagent, onLeaveSubagent, onChoose },
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
                            Nhắn tin để làm việc với AI trong dự án này.
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
                            />
                        ))}
                    </>
                )}
                <div ref={bottom} />
            </div>
        </div>
    );
});
