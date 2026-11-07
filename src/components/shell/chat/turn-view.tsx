import { Repeat } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { ChoiceHandlers } from '@/components/ai-chat/choice-card';
import { MarkdownContent } from '@/components/ai-chat/markdown-content';
import { AttachmentView } from '@/components/shell/chat/attachment-view';
import { splitPrompt } from '@/components/shell/chat/turn';
import type { PermissionRequest, Turn } from '@/components/shell/chat/turn';
import { TurnSteps } from '@/components/shell/turn-steps';
import { useTypewriter } from '@/hooks/use-typewriter';
import { t } from '@/lib/i18n';

// * What the CLIs say when an account runs out of allowance ("You've hit your 5-hour limit", "usage limit reached"...).
const LIMIT_PATTERN =
    /hit your .*limit|usage limit|limit reached|rate limit|hết hạn mức/i;

const MAX_LIMIT_ANSWER_CHARACTERS = 200;
const MAX_REQUEST_CHARACTERS = 300;

/** What the AI wants to do, in one short line: the file, the command or the description it gave. */
function describeRequest(request: PermissionRequest): string {
    const { input } = request;
    const detail = [input.file_path, input.command, input.path, input.url]
        .concat(request.description)
        .find((value) => typeof value === 'string' && value !== '');

    return typeof detail === 'string'
        ? detail.slice(0, MAX_REQUEST_CHARACTERS)
        : JSON.stringify(input).slice(0, MAX_REQUEST_CHARACTERS);
}

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
    onSwitchAccount,
    onPermission,
    projectName,
}: {
    turn: Turn;
    /** Sends this turn again under another account of the same AI. */
    onSwitchAccount: (turn: Turn) => void;
    /** Answers the question of the AI that waits (allow or deny). */
    onPermission: (
        turn: Turn,
        request: PermissionRequest,
        allow: boolean,
    ) => void;
    /** Whether a choice card of this turn can still be answered (the last turn, once it has ended). */
    interactive: boolean;
    /** The message the user sent after this turn, which marks the option picked. */
    followUp: string | null;
    onChoose: (text: string) => void;
    projectName: string;
}) {
    const choices: ChoiceHandlers = useMemo(
        () => ({ interactive, answer: followUp, onChoose }),
        [interactive, followUp, onChoose],
    );
    const typed = useTypewriter(turn.answer, turn.restored !== true);
    const { text, files } = splitPrompt(turn.prompt);
    const waiting = turn.permissions?.[0];
    // * Only the error counts: an answer that merely talks about limits must not offer the switch.
    const hitLimit = LIMIT_PATTERN.test(turn.error ?? '');
    // * The CLI reports a limit twice (as its answer and as the error): only the red error line is shown.
    const answerIsLimit =
        turn.error !== null &&
        turn.answer.length < MAX_LIMIT_ANSWER_CHARACTERS &&
        LIMIT_PATTERN.test(turn.answer);

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
                    <p className="max-h-80 max-w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-2xl bg-muted px-4 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        <HighlightedText text={text} />
                    </p>
                )}
            </div>
            {answerIsLimit ? null : turn.steps !== undefined &&
              turn.steps.length > 0 ? (
                <TurnSteps
                    steps={turn.steps}
                    running={turn.running}
                    changed={turn.changed}
                    choices={choices}
                    projectName={projectName}
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
                    {t('turn_view.answering')}
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
            {turn.running && waiting !== undefined && (
                <div
                    role="group"
                    aria-label={t('turn_view.allow_ai')}
                    className="space-y-2 rounded-lg border bg-muted/40 p-3"
                >
                    <p className="font-medium">
                        {t('turn_view.allow_the_ai_to', { tool: waiting.tool })}
                    </p>
                    <p className="font-mono text-xs break-all text-muted-foreground">
                        {describeRequest(waiting)}
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onPermission(turn, waiting, false)}
                        >
                            {t('turn_view.deny')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => onPermission(turn, waiting, true)}
                        >
                            {t('turn_view.allow')}
                        </Button>
                    </div>
                </div>
            )}
            {interactive && hitLimit && (
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onSwitchAccount(turn)}
                >
                    <Repeat aria-hidden="true" />
                    {t('turn_view.switch_account')}
                </Button>
            )}
        </div>
    );
});
