import {
    ArrowUp,
    MessageSquare,
    Minus,
    PanelBottom,
    PictureInPicture2,
    Plus,
    Square,
    X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import Field from '@/components/form/field';
import { MessageList } from '@/components/shell/chat/message-list';
import type { useSideChat } from '@/components/shell/chat/use-side-chat';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const tabElementId = (id: string) => `${id}-tab`;
const PANEL_ID = 'side-chat-panel';

// * A side chat answers questions only: nothing to choose, switch or allow.
const ignoreChoice = () => undefined;

/** The side chat of a project: tabs of quick, read-only questions to the AI beside the main chat. It stays mounted while hidden, so an answer being written is not lost. The frame (edge, size, fill) comes from DockLayout. */
export function SideChatDock({
    chat,
    projectName,
    open,
    placementMenu,
    alone,
    floating = false,
    onDock,
    onFloat,
    onClose,
    onOpenChat,
}: {
    /** The state of the tabs, kept by the owner so it survives the panel moving to another edge. */
    chat: ReturnType<typeof useSideChat>;
    projectName: string;
    open: boolean;
    /** The Move / Fill and arrange menu button, shared by the dock panels. */
    placementMenu: ReactNode;
    /** Nothing else is shown beside it: no maximize button. */
    alone: boolean;
    /** Hovering over the main chat as a card: it can fold into a round button, and go back to the dock. */
    floating?: boolean;
    /** Back to the dock from the floating card. */
    onDock?: () => void;
    /** Minimize: from the dock to the floating card. */
    onFloat?: () => void;
    onClose: () => void;
    /** Only when the main chat is folded away behind the dock: brings it back. */
    onOpenChat?: () => void;
}) {
    const [question, setQuestion] = useState('');
    const [collapsed, setCollapsed] = useState(false);
    const bottom = useRef<HTMLDivElement>(null);
    const card = useRef<HTMLElement>(null);
    const pill = useRef<HTMLButtonElement>(null);
    const folded = floating && collapsed;
    const { turns } = chat.active;

    // * Each new word of the answer keeps the list at its end.
    useEffect(() => {
        const list = bottom.current?.closest<HTMLElement>('[data-chat-scroll]');

        list?.scrollTo({ top: list.scrollHeight });
    }, [turns, chat.active.id, open]);

    const submit = () => {
        if (question.trim() === '' || chat.active.running) {
            return;
        }

        chat.send(question);
        setQuestion('');
    };

    const onAskKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        // * Enter sends, Shift+Enter breaks the line; Enter that confirms an IME choice is not a send.
        if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();
            submit();

            return;
        }

        // * Ctrl+C with nothing selected (so copying still works) stops the running answer.
        const input = event.currentTarget as HTMLTextAreaElement;

        if (
            chat.active.running &&
            event.ctrlKey &&
            event.key.toLowerCase() === 'c' &&
            input.selectionStart === input.selectionEnd
        ) {
            event.preventDefault();
            chat.stop();
        }
    };

    // * Left/Right (and Home/End) move between the tabs; only the open tab is in the Tab order.
    const onTabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const ids = chat.tabs.map((tab) => tab.id);
        const index = ids.indexOf(chat.active.id);
        const target =
            event.key === 'ArrowRight'
                ? ids[(index + 1) % ids.length]
                : event.key === 'ArrowLeft'
                  ? ids[(index - 1 + ids.length) % ids.length]
                  : event.key === 'Home'
                    ? ids[0]
                    : event.key === 'End'
                      ? ids[ids.length - 1]
                      : undefined;

        if (target === undefined) {
            return;
        }

        event.preventDefault();
        chat.select(target);
        document.getElementById(tabElementId(target))?.focus();
    };

    // * Fold or unfold the floating card; the panel stays mounted so tabs and a running answer survive. Focus follows the control that appears.
    const setFolded = (next: boolean) => {
        setCollapsed(next);
        window.setTimeout(() => {
            if (next) {
                pill.current?.focus();
            } else {
                card.current?.querySelector('textarea')?.focus();
            }
        });
    };

    const closeTab = (id: string) => {
        if (chat.close(id)) {
            onClose();
        }
    };

    return (
        <>
            {folded && (
                <Button
                    ref={pill}
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    aria-label={t('side_chat.expand')}
                    aria-expanded={false}
                    aria-controls={PANEL_ID}
                    title={t('side_chat.expand')}
                    onClick={() => setFolded(false)}
                    className="pointer-events-auto rounded-full bg-background shadow-lg"
                >
                    <MessageSquare aria-hidden="true" className="size-5" />
                </Button>
            )}
            <aside
                ref={card}
                aria-label={t('side_chat.title')}
                hidden={!open || folded}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && !event.defaultPrevented) {
                        if (floating) {
                            setFolded(true);
                        } else {
                            onClose();
                        }
                    }
                }}
                className={cn(
                    'relative min-h-0 min-w-0 flex-1 flex-col bg-background',
                    open && !folded && 'flex',
                    floating &&
                        'pointer-events-auto h-full max-h-[36rem] flex-none rounded-xl border shadow-xl w-full',
                )}
            >
                <header className="flex h-[49px] shrink-0 items-center gap-1 border-b px-2">
                    <div
                        role="tablist"
                        aria-label={t('side_chat.title')}
                        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
                    >
                        {chat.tabs.map((tab) => (
                            <div
                                key={tab.id}
                                role="presentation"
                                className={cn(
                                    'flex shrink-0 items-center rounded-md text-sm text-muted-foreground',
                                    tab.id === chat.active.id &&
                                        'bg-accent text-accent-foreground',
                                )}
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    id={tabElementId(tab.id)}
                                    aria-selected={tab.id === chat.active.id}
                                    aria-controls={PANEL_ID}
                                    tabIndex={
                                        tab.id === chat.active.id ? 0 : -1
                                    }
                                    onKeyDown={onTabKeyDown}
                                    onClick={() => chat.select(tab.id)}
                                    className="max-w-40 truncate rounded-md py-1 pr-1 pl-2 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                >
                                    {t('side_chat.tab_title', {
                                        n: tab.number,
                                    })}
                                </button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('side_chat.close_tab', {
                                        n: tab.number,
                                    })}
                                    onClick={() => closeTab(tab.id)}
                                    className="size-6 text-muted-foreground"
                                >
                                    <X
                                        aria-hidden="true"
                                        className="size-3.5"
                                    />
                                </Button>
                            </div>
                        ))}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('side_chat.new_tab')}
                            title={t('side_chat.new_tab')}
                            onClick={chat.add}
                            className="shrink-0 text-muted-foreground"
                        >
                            <Plus aria-hidden="true" className="size-4" />
                        </Button>
                    </div>
                    {onOpenChat !== undefined && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('workspace_pane.open_chat_panel')}
                            title={t('workspace_pane.open_chat_panel')}
                            onClick={onOpenChat}
                            className="text-muted-foreground"
                        >
                            <MessageSquare
                                aria-hidden="true"
                                className="size-5"
                            />
                        </Button>
                    )}
                    {floating && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('side_chat.collapse')}
                            title={t('side_chat.collapse')}
                            onClick={() => setFolded(true)}
                            className="text-muted-foreground"
                        >
                            <Minus aria-hidden="true" className="size-5" />
                        </Button>
                    )}
                    {!alone && placementMenu}
                    {!alone && (floating ? onDock : onFloat) !== undefined && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t(
                                floating
                                    ? 'side_chat.dock'
                                    : 'side_chat.minimize',
                            )}
                            title={t(
                                floating
                                    ? 'side_chat.dock'
                                    : 'side_chat.minimize',
                            )}
                            onClick={floating ? onDock : onFloat}
                            className="text-muted-foreground"
                        >
                            {floating ? (
                                <PanelBottom
                                    aria-hidden="true"
                                    className="size-5"
                                />
                            ) : (
                                <PictureInPicture2
                                    aria-hidden="true"
                                    className="size-5"
                                />
                            )}
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('side_chat.close')}
                        title={t('side_chat.close')}
                        onClick={onClose}
                        className="text-muted-foreground"
                    >
                        <X aria-hidden="true" className="size-5" />
                    </Button>
                </header>
                <div
                    role="tabpanel"
                    id={PANEL_ID}
                    aria-labelledby={tabElementId(chat.active.id)}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    {turns.length === 0 ? (
                        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
                            {t('side_chat.empty')}
                        </div>
                    ) : (
                        <MessageList
                            ref={bottom}
                            turns={turns}
                            viewSubagent={null}
                            onLeaveSubagent={ignoreChoice}
                            onChoose={ignoreChoice}
                            onSwitchAccount={ignoreChoice}
                            onPermission={ignoreChoice}
                            projectName={projectName}
                        />
                    )}
                </div>
                <div className="shrink-0 border-t p-3">
                    <div className="relative [&_textarea]:pr-12">
                        <Field
                            name="side-chat-question"
                            ui="textarea"
                            className="min-w-0"
                            value={question}
                            placeholder={t('side_chat.ask_placeholder')}
                            aria-label={t('side_chat.ask_placeholder')}
                            autoComplete="off"
                            onChange={(event) =>
                                setQuestion(event.target.value)
                            }
                            onKeyDown={onAskKeyDown}
                        />
                        {chat.active.running ? (
                            <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="absolute right-2 bottom-2 size-8"
                                aria-label={t('side_chat.stop')}
                                title={t('side_chat.stop')}
                                onClick={chat.stop}
                            >
                                <Square aria-hidden="true" className="size-4" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="icon"
                                className="absolute right-2 bottom-2 size-8"
                                aria-label={t('side_chat.send')}
                                title={t('side_chat.send')}
                                disabled={question.trim() === ''}
                                onClick={submit}
                            >
                                <ArrowUp
                                    aria-hidden="true"
                                    className="size-4"
                                />
                            </Button>
                        )}
                    </div>
                </div>
            </aside>
        </>
    );
}
