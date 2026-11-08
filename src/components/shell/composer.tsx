import { ArrowUp, Folder, Mic, Plus, Volume2, X } from 'lucide-react';
import { memo, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { useSpeechInput } from '@/hooks/use-speech-input';
import { shutdownSpeech, useSpeechOutput } from '@/hooks/use-speech-output';
import { setVoiceReply, useVoiceReply } from '@/hooks/use-voice-preferences';
import { VoicePopup } from '@/components/shell/chat/voice-wave';
import { followMicrophone } from '@/lib/voice-level';
import {
    pastedFiles,
    pastedPaths,
    type Attachment,
} from '@/components/shell/chat/attachment';
import { AttachmentList } from '@/components/shell/chat/attachment-list';
import { MODES } from '@/components/shell/chat/cli-options';
import { ComposerTools } from '@/components/shell/chat/composer-tools';
import { Inert } from '@/components/shell/chat/inert-button';
import { ModelMenu } from '@/components/shell/chat/model-menu';
import { SuggestionList } from '@/components/shell/chat/suggestion-list';
import { useCommandSuggestions } from '@/components/shell/chat/use-command-suggestions';
import { Button } from '@/components/ui/button';
import { referenceForPaste } from '@/lib/editor-copy';
import { splitPrompt } from '@/components/shell/chat/turn';
import type { AgentCli } from '@/lib/ide';
import type { ToolEntry } from '@/lib/ide-tools';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CHAT_PROMPT_MAX_LENGTH } from '@/lib/limits';

export { MODES, pastedPaths };
export type { Attachment };

/** Message box of the chat. Typing, picking the CLI and sending work; attachments, optimise, read aloud and recording are shown but disabled. */
// * Memoised: the chat re-renders on every streamed piece of an answer, and the box (menus, suggestions) has nothing new to show then.
export const Composer = memo(function Composer({
    project,
    onClearProject,
    value,
    onChange,
    onSubmit,
    busy,
    waiting,
    onClearWaiting,
    onStop,
    cli,
    model,
    onChoose,
    onAddFiles,
    attachments,
    attachError,
    onPasteFiles,
    onPastePaths,
    onPasteReference,
    onRemoveAttachment,
    lastAnswer,
    freshAnswer,
    popup,
}: {
    /** Name of the project the conversation is attached to (null: none). */
    project: string | null;
    onClearProject: () => void;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** A turn is running: switching CLI and the other controls wait for it; sending does not (a message sent meanwhile starts its own turn if a sub-agent works, else it waits for the turn). */
    busy: boolean;
    /** Messages sent while a turn runs that wait for it (shown above the box), and the button that drops them. */
    waiting: string[];
    onClearWaiting: () => void;
    /** Ctrl+C while a turn runs: stops it. */
    onStop: () => void;
    cli: AgentCli;
    /** Model of the chosen CLI (null: its default). */
    model: string | null;
    /** A model picked under one of the CLIs: picks that CLI and that model together. */
    onChoose: (cli: AgentCli, model: string | null) => void;
    /** * The "+" button: the host lets the person pick files to add to the message. */
    onAddFiles: () => void;
    attachments: Attachment[];
    /** Why the last pasted item was refused (null: none). */
    attachError: string | null;
    /** Images or files pasted into the box. */
    onPasteFiles: (files: File[]) => void;
    /** Paths of files on disk pasted as text. */
    onPastePaths: (paths: string[]) => void;
    /** Code copied from the editor was pasted: `path:start-end`, shown as a chip. */
    onPasteReference: (reference: string) => void;
    onRemoveAttachment: (id: string) => void;
    /** The assistant's last finished answer (markdown): the speaker button reads it aloud. */
    lastAnswer: string;
    /** An answer that finished just now in this chat (not one loaded from the history): voice replies read it. */
    freshAnswer: { id: string; text: string } | null;
    /** Laid above the top of the message box (the session rail popup). */
    popup?: ReactNode;
}) {
    // * Dictation: each final phrase is appended to what is typed (the ref keeps two phrases in a row from overwriting each other).
    const typed = useRef(value);

    typed.current = value;

    const dictation = useSpeechInput((phrase) => {
        if (phrase === '') {
            return;
        }

        typed.current =
            typed.current === '' || /\s$/.test(typed.current)
                ? typed.current + phrase
                : `${typed.current} ${phrase}`;
        onChange(typed.current);
    }, !busy);
    const reading = useSpeechOutput(lastAnswer);
    const voiceReply = useVoiceReply();
    const { speak: speakReply, stop: stopReading } = reading;
    // * Each fresh answer is looked at once; with voice replies off it is only marked as seen, so turning them on later does not read it.
    const seenAnswer = useRef<string | null>(null);

    useEffect(() => {
        if (freshAnswer === null || seenAnswer.current === freshAnswer.id) {
            return;
        }

        seenAnswer.current = freshAnswer.id;

        if (voiceReply) {
            speakReply(freshAnswer.text);
        }
    }, [freshAnswer, voiceReply, speakReply]);

    const { listening, failed: dictationFailed } = dictation;

    // * With voice replies on, the wave follows the microphone while dictating (the level is simulated without the permission).
    useEffect(() => {
        if (!voiceReply) {
            return;
        }

        void followMicrophone(listening);

        return () => {
            void followMicrophone(false);
        };
    }, [voiceReply, listening]);

    // * Escape stops listening and reading, whatever has the focus.
    const { stop: stopDictation } = dictation;

    useEffect(() => {
        if (!listening && !reading.active) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                stopDictation();
                stopReading();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [listening, reading.active, stopDictation, stopReading]);

    const submit = (event: FormEvent) => {
        event.preventDefault();

        if (value.trim() !== '' || attachments.length > 0) {
            dictation.stop();
            // * A new message ends the reading of the old answer.
            stopReading();
            onSubmit();
        }
    };
    const {
        prefix,
        suggestions,
        activeSuggestion,
        setActiveSuggestion,
        setDismissed,
        menuOpen,
        completed,
    } = useCommandSuggestions(value);
    const pick = (entry: ToolEntry) => {
        onChange(completed(entry));
        setActiveSuggestion(0);
    };
    const input = useRef<HTMLTextAreaElement>(null);

    return (
        <form
            onSubmit={submit}
            className="relative mx-auto w-[min(100%-2rem,48rem)] pb-4"
        >
            {voiceReply && (listening || reading.active || dictationFailed) ? (
                <VoicePopup
                    label={
                        listening
                            ? t('voice_transcript.listening')
                            : reading.active
                              ? t('voice_transcript.reading')
                              : t('voice_transcript.failed')
                    }
                    reading={reading.active}
                    failed={!listening && !reading.active}
                    onClose={() => {
                        dictation.stop();

                        if (reading.active) {
                            reading.stop();
                        }
                    }}
                />
            ) : (
                popup
            )}
            {project !== null && (
                <div className="mb-2 flex items-center gap-2">
                    <>
                        <span className="flex h-9 items-center gap-2 rounded-md bg-card px-3 text-sm">
                            <Folder
                                aria-hidden="true"
                                className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{project}</span>
                            <button
                                type="button"
                                aria-label={t('composer.deselect_project')}
                                onClick={onClearProject}
                                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                <X aria-hidden="true" className="size-3.5" />
                            </button>
                        </span>
                        <Inert
                            label={t('composer.add_project')}
                            className="text-muted-foreground"
                        >
                            <Plus aria-hidden="true" />
                        </Inert>
                    </>
                </div>
            )}
            <div
                className="relative @container cursor-text rounded-md border bg-card p-3"
                onMouseDown={(event) => {
                    // * A click on the empty parts of the box (not a button or the text itself) lands in the message field.
                    if (
                        event.target === event.currentTarget ||
                        (event.target instanceof HTMLElement &&
                            event.target.dataset.focusInput !== undefined)
                    ) {
                        event.preventDefault();
                        input.current?.focus();
                    }
                }}
            >
                <AttachmentList
                    attachments={attachments}
                    attachError={attachError}
                    onRemove={onRemoveAttachment}
                />
                {waiting.length > 0 && (
                    <div className="text-muted-foreground flex items-center gap-1 px-2 pt-1 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                            {t('composer.waiting', {
                                count: waiting.length,
                                text: waiting
                                    .map((prompt) => {
                                        const { text, files } =
                                            splitPrompt(prompt);

                                        return [
                                            text,
                                            ...files.map((file) => file.name),
                                        ]
                                            .filter((part) => part !== '')
                                            .join(' ');
                                    })
                                    .join(' / '),
                            })}
                        </span>
                        <button
                            type="button"
                            onClick={onClearWaiting}
                            aria-label={t('composer.clear_waiting')}
                            className="hover:text-foreground shrink-0 rounded"
                        >
                            <X className="size-3" />
                        </button>
                    </div>
                )}
                {menuOpen && (
                    <SuggestionList
                        prefix={prefix}
                        suggestions={suggestions}
                        activeSuggestion={activeSuggestion}
                        onPick={pick}
                    />
                )}
                <textarea
                    ref={input}
                    value={
                        dictation.interim === ''
                            ? value
                            : `${value}${value === '' || /\s$/.test(value) ? '' : ' '}${dictation.interim}`
                    }
                    maxLength={CHAT_PROMPT_MAX_LENGTH}
                    onChange={(event) => {
                        onChange(event.target.value);
                        setActiveSuggestion(0);
                        setDismissed(false);
                    }}
                    onPaste={(event) => {
                        const { clipboardData } = event;
                        const files = pastedFiles(clipboardData);
                        const pastedText = clipboardData.getData('text/plain');
                        const paths = pastedPaths(pastedText);
                        const reference = referenceForPaste(pastedText);

                        // * Pasted images and files become attachments; so do pasted paths of files on disk (Finder's "Copy as Pathname"). Other text pastes as usual.
                        if (files.length > 0) {
                            event.preventDefault();
                            onPasteFiles(files);
                        } else if (reference !== null) {
                            // * Code copied from the editor becomes a `file:lines` chip: the AI reads the file itself, so the message stays short.
                            event.preventDefault();
                            onPasteReference(reference);
                        } else if (paths.length > 0) {
                            event.preventDefault();
                            onPastePaths(paths);
                        }
                    }}
                    onKeyDown={(event) => {
                        // * Ctrl+C with nothing selected (so copying still works) stops the running turn.
                        if (
                            busy &&
                            event.ctrlKey &&
                            event.key.toLowerCase() === 'c' &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd
                        ) {
                            event.preventDefault();
                            onStop();

                            return;
                        }

                        if (menuOpen) {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setActiveSuggestion(
                                    (activeSuggestion + 1) % suggestions.length,
                                );

                                return;
                            }

                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setActiveSuggestion(
                                    (activeSuggestion +
                                        suggestions.length -
                                        1) %
                                        suggestions.length,
                                );

                                return;
                            }

                            if (event.key === 'Enter' || event.key === 'Tab') {
                                event.preventDefault();
                                pick(suggestions[activeSuggestion]);

                                return;
                            }

                            if (event.key === 'Escape') {
                                setDismissed(true);

                                return;
                            }
                        }

                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                        }
                    }}
                    rows={2}
                    aria-label={t('composer.message')}
                    placeholder={
                        listening
                            ? t('voice_transcript.speak')
                            : t('composer.message_the_ai_assistant')
                    }
                    className="block w-full resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                <div
                    data-focus-input
                    className="mt-2 flex flex-wrap items-center gap-1"
                >
                    {project === null ? (
                        <ComposerTools busy={busy} onAddFiles={onAddFiles} />
                    ) : (
                        <Inert
                            label={t('common.add')}
                            className="text-muted-foreground"
                        >
                            <Plus aria-hidden="true" />
                        </Inert>
                    )}
                    <span className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1">
                        <ModelMenu
                            busy={busy}
                            cli={cli}
                            model={model}
                            onChoose={onChoose}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('composer.voice_reply')}
                            aria-pressed={voiceReply}
                            title={
                                reading.failure !== null
                                    ? t('composer.speech_output_failed', {
                                          reason: reading.failure,
                                      })
                                    : t('composer.voice_reply')
                            }
                            disabled={!reading.supported}
                            onClick={() => {
                                const next = !voiceReply;

                                setVoiceReply(next);

                                // * Off: every voice stops at once and the audio machinery is let go.
                                if (!next) {
                                    shutdownSpeech();
                                }
                            }}
                            onContextMenu={(event) => {
                                // * Right click reads the last answer (or stops reading), as the old speaker button did.
                                event.preventDefault();

                                if (lastAnswer.trim() !== '') {
                                    reading.toggle();
                                }
                            }}
                            className={cn(
                                'text-muted-foreground',
                                voiceReply &&
                                    'bg-accent text-accent-foreground',
                            )}
                        >
                            <Volume2 aria-hidden="true" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('composer.record')}
                            aria-pressed={dictation.listening}
                            title={
                                !dictation.supported
                                    ? t('composer.no_speech_input')
                                    : dictation.failed
                                      ? t('composer.speech_input_failed')
                                      : t('composer.record')
                            }
                            disabled={!dictation.supported || busy}
                            onClick={dictation.toggle}
                            className={cn(
                                'text-muted-foreground',
                                dictation.listening &&
                                    'animate-pulse text-red-500',
                                // * A failed recording (permission refused...) is a warning, not the red of "listening".
                                !dictation.listening &&
                                    dictation.failed &&
                                    'text-amber-500',
                            )}
                        >
                            <Mic aria-hidden="true" />
                        </Button>
                        <Button
                            type="submit"
                            size="icon-sm"
                            disabled={
                                value.trim() === '' && attachments.length === 0
                            }
                            aria-label={t('common.send')}
                            className="rounded-full"
                        >
                            <ArrowUp aria-hidden="true" />
                        </Button>
                    </span>
                </div>
            </div>
        </form>
    );
});
