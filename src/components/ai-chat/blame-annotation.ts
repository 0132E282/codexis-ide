import { useEffect } from 'react';
import * as monaco from 'monaco-editor';
import type { editor } from 'monaco-editor';
import type { GitBlameLine } from '@/lib/ide';
import { getLanguage, t } from '@/lib/i18n';

const SUBJECT_LIMIT = 50;
const CURSOR_DEBOUNCE_MS = 150;
// * Under this many pixels of free room the note is not drawn at all (it would only be a stub).
const MIN_NOTE_WIDTH = 120;
const NOTE_GAP = 24;
const HIDE_DELAY_MS = 150;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
];

function formatRelativeTime(timestamp: number): string {
    const seconds = timestamp - Date.now() / 1000;
    const formatter = new Intl.RelativeTimeFormat(getLanguage(), {
        numeric: 'auto',
    });

    for (const [unit, size] of UNITS) {
        if (Math.abs(seconds) >= size) {
            return formatter.format(Math.round(seconds / size), unit);
        }
    }

    return formatter.format(0, 'second');
}

function shorten(text: string): string {
    return text.length > SUBJECT_LIMIT
        ? `${text.slice(0, SUBJECT_LIMIT - 1)}…`
        : text;
}

function describe(blame: GitBlameLine): {
    text: string;
    card: string[];
} {
    if (!blame.committed) {
        return {
            text: t('blame.uncommitted'),
            card: [t('blame.uncommitted_hover')],
        };
    }

    const fullDate = new Date(blame.timestamp * 1000).toLocaleString(
        getLanguage(),
    );

    return {
        text: `${blame.authorName}, ${formatRelativeTime(blame.timestamp)} • ${shorten(blame.subject)}`,
        card: [
            `${blame.shortHash} · ${blame.authorName}`,
            fullDate,
            blame.subject,
        ],
    };
}

/** * GitLens "current line": a muted note after the end of the line the caret is on (author, time, subject), with a hover card. `lines` null (no blame, switch off, unsaved edits) shows nothing. The note is a content widget laid over the free room at the end of the line, never text of the line: it cannot wrap the line or change its height, and it hides when the line leaves no room. */
export function useBlameAnnotation(
    instance: editor.IStandaloneCodeEditor | null,
    lines: GitBlameLine[] | null,
): void {
    useEffect(() => {
        if (instance === null || lines === null) {
            return;
        }

        // * One index per blame: a caret move is a lookup, not a scan.
        const byLine = new Map(lines.map((item) => [item.line, item]));
        const noteNode = document.createElement('div');
        const cardNode = document.createElement('div');
        let timer: number | undefined;
        let noteLine = 0;
        let isNoteShown = false;
        let cardLines: string[] = [];

        noteNode.className = 'pm-blame';
        cardNode.className = 'pm-blame-card';

        const positionOf = (lineNumber: number) => ({
            lineNumber,
            column: instance.getModel()?.getLineMaxColumn(lineNumber) ?? 1,
        });
        const noteWidget: editor.IContentWidget = {
            getId: () => 'pm.blame-note',
            getDomNode: () => noteNode,
            getPosition: () => ({
                position: positionOf(noteLine),
                preference: [
                    monaco.editor.ContentWidgetPositionPreference.EXACT,
                ],
            }),
        };
        const cardWidget: editor.IContentWidget = {
            getId: () => 'pm.blame-card',
            getDomNode: () => cardNode,
            getPosition: () => ({
                position: { lineNumber: noteLine, column: 1 },
                preference: [
                    monaco.editor.ContentWidgetPositionPreference.BELOW,
                    monaco.editor.ContentWidgetPositionPreference.ABOVE,
                ],
            }),
        };
        let hideTimer: number | undefined;
        let isCardOpen = false;
        // * The card is added once with the note and only shown or hidden: no widget comes or goes while the pointer moves.
        const hideCard = () => {
            window.clearTimeout(hideTimer);
            // * Monaco writes `display` and `visibility` on its widgets itself: the closed state is a class that the stylesheet forces with !important.
            cardNode.classList.remove('pm-blame-card-open');
            isCardOpen = false;
        };
        const showCard = () => {
            window.clearTimeout(hideTimer);
            if (!isCardOpen) {
                cardNode.replaceChildren(
                    ...cardLines.map((text) => {
                        const row = document.createElement('div');

                        row.textContent = text;

                        return row;
                    }),
                );
                cardNode.classList.add('pm-blame-card-open');
                isCardOpen = true;
            }
        };
        const hideNote = () => {
            hideCard();
            if (isNoteShown) {
                instance.removeContentWidget(noteWidget);
                instance.removeContentWidget(cardWidget);
                isNoteShown = false;
            }
        };
        // * Fits the note into the room right of the line's last text (after a wrap, of its last row); no room, no note.
        const placeNote = () => {
            const visible = instance.getScrolledVisiblePosition(
                positionOf(noteLine),
            );
            const room = visible
                ? instance.getLayoutInfo().contentWidth -
                  visible.left -
                  NOTE_GAP
                : 0;

            if (room < MIN_NOTE_WIDTH) {
                hideNote();

                return;
            }

            noteNode.style.maxWidth = `${room}px`;
            if (isNoteShown) {
                instance.layoutContentWidget(noteWidget);
                instance.layoutContentWidget(cardWidget);
            } else {
                instance.addContentWidget(noteWidget);
                instance.addContentWidget(cardWidget);
                isNoteShown = true;
            }
        };
        const show = () => {
            const lineNumber = instance.getPosition()?.lineNumber;
            const blame =
                lineNumber === undefined ? undefined : byLine.get(lineNumber);

            if (
                lineNumber === undefined ||
                blame === undefined ||
                lineNumber > (instance.getModel()?.getLineCount() ?? 0)
            ) {
                hideNote();
                noteLine = 0;

                return;
            }
            // * The caret stayed on the line: nothing to redo.
            if (lineNumber === noteLine && isNoteShown) {
                return;
            }

            const { text, card } = describe(blame);

            hideCard();
            noteLine = lineNumber;
            noteNode.textContent = text;
            cardLines = card;
            placeNote();
        };
        const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(show, CURSOR_DEBOUNCE_MS);
        };
        // * A resize or a wrap change moves the end of the line: the note is fitted again.
        const relayout = () => {
            if (noteLine !== 0) {
                placeNote();
            }
        };
        const subscriptions = [
            instance.onDidChangeCursorPosition(schedule),
            instance.onDidLayoutChange(relayout),
            // * The note lets clicks through (pointer-events none), so the hover is found from the pointer's place: over the note shows the card, away from it hides the card after a short delay.
            instance.onMouseMove((event) => {
                if (!isNoteShown) {
                    return;
                }

                const box = noteNode.getBoundingClientRect();
                const { posx, posy } = event.event;
                const isOnNote =
                    posx >= box.left &&
                    posx <= box.right &&
                    posy >= box.top &&
                    posy <= box.bottom;

                if (isOnNote) {
                    showCard();
                } else if (isCardOpen) {
                    window.clearTimeout(hideTimer);
                    hideTimer = window.setTimeout(hideCard, HIDE_DELAY_MS);
                }
            }),
            instance.onMouseLeave(hideCard),
        ];

        show();

        return () => {
            window.clearTimeout(timer);
            for (const subscription of subscriptions) {
                subscription.dispose();
            }
            hideNote();
        };
    }, [instance, lines]);
}
