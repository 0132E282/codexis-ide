import { ArrowUp, Folder, Mic, Plus, Volume2, X } from 'lucide-react';
import { memo, useRef, type FormEvent } from 'react';
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
import { ProjectRow } from '@/components/shell/chat/project-row';
import { SuggestionList } from '@/components/shell/chat/suggestion-list';
import { useCommandSuggestions } from '@/components/shell/chat/use-command-suggestions';
import { Button } from '@/components/ui/button';
import { referenceForPaste } from '@/lib/editor-copy';
import type { AgentCli } from '@/lib/ide';
import type { ToolEntry } from '@/lib/ide-tools';
import { t } from '@/lib/i18n';

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
    onStop,
    cli,
    model,
    onChoose,
    mode,
    onModeChange,
    agentTeam,
    onAgentTeamChange,
    onAddFiles,
    attachments,
    attachError,
    onPasteFiles,
    onPastePaths,
    onRemoveAttachment,
    projectName,
    otherProjects,
    extraRoots,
    onExtraRootsChange,
    worktree,
    onWorktreeChange,
}: {
    /** Name of the project the conversation is attached to (null: none). */
    project: string | null;
    onClearProject: () => void;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** A turn is running: sending and switching CLI wait for it. */
    busy: boolean;
    /** Ctrl+C while a turn runs: stops it. */
    onStop: () => void;
    cli: AgentCli;
    /** Model of the chosen CLI (null: its default). */
    model: string | null;
    /** Permission mode of the Claude CLI. */
    mode: string;
    onModeChange: (mode: string) => void;
    /** The Claude CLI's experimental agent teams are on. */
    agentTeam: boolean;
    onAgentTeamChange: (on: boolean) => void;
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
    onRemoveAttachment: (id: string) => void;
    /** Name of the project this chat belongs to. */
    projectName: string;
    /** Saved projects other than the one this chat belongs to. */
    otherProjects: { root: string; name: string }[];
    /** Folders of the other projects the AI may also work in. */
    extraRoots: string[];
    onExtraRootsChange: (roots: string[]) => void;
    /** Worktree mode: the AI works on its own git branch, in a copy of the project. */
    worktree: boolean;
    onWorktreeChange: (on: boolean) => void;
}) {
    const submit = (event: FormEvent) => {
        event.preventDefault();

        if ((value.trim() !== '' || attachments.length > 0) && !busy) {
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
            className="mx-auto w-[min(100%-2rem,48rem)] pb-4"
        >
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
                    value={value}
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
                            // * Code copied from the editor goes in as `file:lines`: the AI reads the file itself, so the message stays short.
                            event.preventDefault();

                            const field = event.currentTarget;
                            const start = field.selectionStart;
                            const caret = start + reference.length;

                            onChange(
                                value.slice(0, start) +
                                    reference +
                                    value.slice(field.selectionEnd),
                            );
                            requestAnimationFrame(() =>
                                field.setSelectionRange(caret, caret),
                            );
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
                    placeholder={t('composer.message_the_ai_assistant')}
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
                    <span className="ml-auto flex items-center gap-1">
                        <ModelMenu
                            busy={busy}
                            cli={cli}
                            model={model}
                            onChoose={onChoose}
                        />
                        <Inert
                            label={t('composer.read_aloud')}
                            className="text-muted-foreground"
                        >
                            <Volume2 aria-hidden="true" />
                        </Inert>
                        <Inert
                            label={t('composer.record')}
                            className="text-muted-foreground"
                        >
                            <Mic aria-hidden="true" />
                        </Inert>
                        <Button
                            type="submit"
                            size="icon-sm"
                            disabled={
                                busy ||
                                (value.trim() === '' &&
                                    attachments.length === 0)
                            }
                            aria-label={t('common.send')}
                            className="rounded-full"
                        >
                            <ArrowUp aria-hidden="true" />
                        </Button>
                    </span>
                </div>
            </div>
            <ProjectRow
                busy={busy}
                projectName={projectName}
                otherProjects={otherProjects}
                extraRoots={extraRoots}
                onExtraRootsChange={onExtraRootsChange}
                worktree={worktree}
                onWorktreeChange={onWorktreeChange}
                cli={cli}
                mode={mode}
                onModeChange={onModeChange}
                agentTeam={agentTeam}
                onAgentTeamChange={onAgentTeamChange}
            />
        </form>
    );
});
