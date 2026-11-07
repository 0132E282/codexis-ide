import { useEffect, useRef, useState } from 'react';
import type { Turn } from '@/components/shell/chat/turn';
import { isChatActive } from '@/hooks/use-voice-preferences';

/** The answer of a turn that finished in this session (it was seen running, then done), once, and only while this chat is the one in use. Turns loaded from the history, or a conversation opened again, never count. */
export function useFreshAnswer(
    turns: Turn[],
    chatId: string,
): { id: string; text: string } | null {
    const [fresh, setFresh] = useState<{ id: string; text: string } | null>(
        null,
    );
    const seenRunning = useRef(new Set<string>());
    const announced = useRef(new Set<string>());

    useEffect(() => {
        for (const turn of turns) {
            if (turn.running) {
                seenRunning.current.add(turn.id);
            } else if (
                seenRunning.current.has(turn.id) &&
                !announced.current.has(turn.id) &&
                turn.answer !== ''
            ) {
                announced.current.add(turn.id);

                if (isChatActive(chatId)) {
                    setFresh({ id: turn.id, text: turn.answer });
                }
            }
        }
    }, [turns, chatId]);

    return fresh;
}
