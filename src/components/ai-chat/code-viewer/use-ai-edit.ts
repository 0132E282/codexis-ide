import { t } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { invalidateAiChatCache } from '@/lib/ai-chat-cache';
import { requestErrorMessage } from '@/lib/ai-error';
import type { AiChatProposal } from '@/types';

/** * The AI's edit of the open local file: the pending one (apply / drop), the applied one (take back), and the "typed" reveal of a new diff. */
export function useAiEdit({
    repo,
    localRoot,
    selected,
    proposed,
    base,
    content,
    changes,
    openFile,
    onChangesUpdate,
}: {
    repo: string;
    localRoot: string | null;
    selected: string | null;
    proposed: string | null;
    base: string | null;
    content: string | null;
    changes: AiChatProposal[];
    openFile: (
        path: string,
        discardCurrent?: boolean,
        fresh?: AiChatProposal[],
    ) => Promise<void>;
    onChangesUpdate?: (proposals: AiChatProposal[]) => void;
}) {
    // * The AI's pending edit of the open file (a local project): the tick in the header writes it, the cross drops it.
    const pendingEdit =
        localRoot !== null && proposed !== null && selected !== null
            ? changes.find(
                  (change) =>
                      change.repo === repo &&
                      change.path === selected &&
                      change.status === 'pending' &&
                      change.message_id !== undefined,
              )
            : undefined;
    // * An edit already written to the file: the same arrow takes it back (revert-local).
    const appliedEdit =
        localRoot !== null && selected !== null
            ? changes.find(
                  (change) =>
                      change.repo === repo &&
                      change.path === selected &&
                      change.status === 'applied' &&
                      change.message_id !== undefined,
              )
            : undefined;
    const boxHost = useRef<HTMLDivElement>(null);
    // * Takes every comment box away (the edit was decided, or another file opens).
    const closeBoxes = () =>
        boxHost.current?.dispatchEvent(new Event('pm-close-boxes'));
    // * A new edit of the AI is "typed" into the diff: its lines show up one burst after another (null: all shown).
    const [revealed, setRevealed] = useState<number | null>(null);
    const pendingId = pendingEdit?.id;

    useEffect(() => {
        const total =
            proposed === null
                ? 0
                : Math.max(
                      proposed.split('\n').length,
                      (base ?? content ?? '').split('\n').length,
                  );

        if (
            pendingId === undefined ||
            total < 2 ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
            setRevealed(null);

            return;
        }

        // * Starts at the first changed line: the untouched head of the file is not "typed".
        const old = (base ?? content ?? '').split('\n');
        const next = (proposed ?? '').split('\n');
        let shown = 0;

        while (
            shown < old.length &&
            shown < next.length &&
            old[shown] === next[shown]
        ) {
            shown++;
        }

        setRevealed(shown);

        // * Frame-driven and time-based (about 25 lines a second, 0.8 to 3 s in all): each frame shows the lines due by now, so the typing flows instead of stepping on a timer.
        const first = shown;
        const duration = Math.min(3000, Math.max(800, (total - first) * 40));
        const started = performance.now();
        let frame = 0;
        let last = first;

        const tick = (now: number) => {
            const due =
                first +
                Math.floor(((now - started) / duration) * (total - first));

            if (due >= total) {
                setRevealed(null);

                return;
            }

            // * Only a line that is new re-renders the diff.
            if (due !== last) {
                last = due;
                setRevealed(due);
            }

            frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(frame);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingId, proposed === null]);
    const [deciding, setDeciding] = useState(false);
    const decideEdit = async (kind: 'apply' | 'reject' | 'revert') => {
        const target = pendingEdit ?? appliedEdit;

        if (target?.message_id === undefined) {
            return;
        }

        setDeciding(true);

        try {
            const { data } = await api.post<{ proposals: AiChatProposal[] }>(
                `/ai-chat/messages/${target.message_id}/proposals/${
                    {
                        apply: 'apply-local',
                        reject: 'reject',
                        revert: 'revert-local?force=1',
                    }[kind]
                }`,
            );

            invalidateAiChatCache(`file.${repo}.`);
            onChangesUpdate?.(data.proposals);
            closeBoxes();

            // * Reopen the file: the written version (or, once dropped, the one on disk).
            if (selected !== null) {
                void openFile(selected, true, data.proposals);
            }
        } catch (caught) {
            toast.error(
                requestErrorMessage(
                    caught,
                    t('use_ai_edit.could_not_process_this'),
                ),
            );
        } finally {
            setDeciding(false);
        }
    };

    return {
        pendingEdit,
        appliedEdit,
        boxHost,
        revealed,
        deciding,
        decideEdit,
    };
}
