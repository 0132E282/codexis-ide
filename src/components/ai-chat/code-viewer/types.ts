import type { AiChatActivityStep } from '@/types';
import type { InlineAnswer } from '@/components/ai-chat/inline-ask';

/** * Lines the person picked in a file: the chat takes them as a reference. */
export type AskReference = {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
};

/** * "Chat với AI về đoạn này" answers in a comment box under the lines: asks about them and returns the answer (the same conversation continues with `conversation`). */
export type InlineAskHandler = (
    reference: AskReference,
    question: string,
    conversation: string | null,
    signal: AbortSignal,
    onStep: (step: AiChatActivityStep) => void,
    files: File[],
) => Promise<InlineAnswer>;
