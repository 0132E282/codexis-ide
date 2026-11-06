import { memo, useMemo } from 'react';
import type { ChoiceHandlers } from '@/components/ai-chat/choice-card';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { AttachmentView } from '@/components/shell/chat/attachment-view';
import { splitPrompt } from '@/components/shell/chat/turn';
import type { Turn } from '@/components/shell/chat/turn';
import { TurnSteps } from '@/components/shell/turn-steps';
import { useTypewriter } from '@/hooks/use-typewriter';

/** The text of a message with each `/command` at the start of a line (or after a space) highlighted. */
function HighlightedText({ text }: { text: string }) {
    return text
        .split(/((?:^|(?<=\s))\/[\w:-]+(?=\s|$))/g)
        .map((piece, index) =>
            index % 2 === 1 ? (
                <span key={index} className="font-medium text-primary">
                    {piece}
                </span>
            ) : (
                piece
            ),
        );
}

// * Memoised: dragging the panel edge re-renders the panel on every frame, and every streamed piece of the running turn re-renders the panel; a finished turn's long markdown answer must not be parsed again each time.
export const TurnView = memo(function TurnView({
    turn,
    interactive,
    followUp,
    onChoose,
}: {
    turn: Turn;
    /** Whether a choice card of this turn can still be answered (the last turn, once it has ended). */
    interactive: boolean;
    /** The message the user sent after this turn, which marks the option picked. */
    followUp: string | null;
    onChoose: (text: string) => void;
}) {
    const choices: ChoiceHandlers = useMemo(
        () => ({ interactive, answer: followUp, onChoose }),
        [interactive, followUp, onChoose],
    );
    const typed = useTypewriter(turn.answer, turn.restored !== true);
    const { text, files } = splitPrompt(turn.prompt);

    return (
        <div className="min-w-0 space-y-3">
            <div className="ml-auto flex w-fit max-w-[85%] min-w-0 flex-col items-end gap-2">
                {files.length > 0 && (
                    <ul className="flex flex-wrap justify-end gap-2">
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
                    <p className="rounded-2xl bg-muted px-4 py-2.5 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                        <HighlightedText text={text} />
                    </p>
                )}
            </div>
            {turn.steps !== undefined && turn.steps.length > 0 ? (
                <TurnSteps
                    steps={turn.steps}
                    running={turn.running}
                    choices={choices}
                />
            ) : (
                typed !== '' && (
                    <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                        <MarkdownContent content={typed} choices={choices} />
                    </div>
                )
            )}
            {turn.running && turn.answer === '' && turn.steps === undefined && (
                <p
                    role="status"
                    className="flex items-center gap-2 text-muted-foreground"
                >
                    Đang trả lời
                    <span
                        aria-hidden="true"
                        className="flex items-center gap-1"
                    >
                        {[0, 150, 300].map((delay) => (
                            <span
                                key={delay}
                                style={{ animationDelay: `${delay}ms` }}
                                className="size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
                            />
                        ))}
                    </span>
                </p>
            )}
            {turn.error !== null && (
                <p role="alert" className="text-destructive">
                    {turn.error}
                </p>
            )}
        </div>
    );
});
