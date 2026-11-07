import { onAiChatCacheInvalidated } from '@/lib/ai-chat-cache';
import { t } from '@/lib/i18n';
import type {
    GitBranchCompare,
    GitBranchesInfo,
    GitCommit,
    GitCommitFile,
    GitFileDiff,
} from '@/lib/ide';

const MAX_CACHED_DIFFS = 60;

export type CachedPage = { commits: GitCommit[]; hasMore: boolean };

// * Kept for the session so closing, reopening or switching the tab shows the last list at once while a fresh one is read; commits, their files and diffs never change once made, so only the lists and the branch data are dropped when a checkout, merge or pull happens.
export const pageCache = new Map<string, CachedPage>();
export const branchesCache = new Map<string, GitBranchesInfo>();
export const compareCache = new Map<string, GitBranchCompare>();
export const filesCache = new Map<string, GitCommitFile[]>();
export const diffCache = new Map<string, GitFileDiff>();
export const invalidationSubscribers = new Set<() => void>();

onAiChatCacheInvalidated((prefix) => {
    if (!prefix.startsWith('branches:local:')) {
        return;
    }

    pageCache.clear();
    branchesCache.clear();
    compareCache.clear();
    invalidationSubscribers.forEach((subscriber) => subscriber());
});

export function rememberDiff(key: string, value: GitFileDiff) {
    diffCache.delete(key);
    diffCache.set(key, value);

    if (diffCache.size > MAX_CACHED_DIFFS) {
        diffCache.delete(diffCache.keys().next().value as string);
    }
}

export const NOT_REPOSITORY = 'git.not_repository';

export function describeError(error: unknown): string {
    return typeof error === 'string' ? error : t('common.something_went_wrong');
}

/** What one request of the pane is doing: nothing yet, running, done, or failed with the backend's message. */
export type Request<Value> =
    | { state: 'loading' }
    | { state: 'done'; value: Value }
    | { state: 'failed'; message: string };
