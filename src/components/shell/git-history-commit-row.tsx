import { ChevronDown, ChevronRight, GitCommitHorizontal } from 'lucide-react';
import { memo, useState } from 'react';
import { getLanguage } from '@/lib/i18n';
import type { GitCommit } from '@/lib/ide';
import type { GithubProfile } from '@/lib/ide-auth';
import { cn } from '@/lib/utils';

// * Fixed row height (px) so the list can show only the rows in view.
export const ROW_HEIGHT = 28;

const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
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

    for (const [unit, size] of TIME_UNITS) {
        if (Math.abs(seconds) >= size) {
            return formatter.format(Math.round(seconds / size), unit);
        }
    }

    return formatter.format(0, 'second');
}

const REF_STYLE: Record<string, string> = {
    head: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
    local: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    remote: 'bg-violet-500/20 text-violet-700 dark:text-violet-300',
    tag: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
};

const NOREPLY_EMAIL = /^(?:(\d+)\+)?([^@+\s]+)@users\.noreply\.github\.com$/i;

/** Login and numeric id (when the email has one) of a GitHub noreply email; null for any other email. */
export function parseGithubAuthor(
    email: string,
): { login: string; id: string | undefined } | null {
    const match = NOREPLY_EMAIL.exec(email.trim());

    return match === null ? null : { id: match[1], login: match[2] };
}

/** GitHub avatar address of a commit author, or null when the email is not a GitHub one. */
function getGithubAvatarUrl(email: string): string | null {
    const author = parseGithubAuthor(email);

    if (author === null) {
        return null;
    }

    return author.id !== undefined
        ? `https://avatars.githubusercontent.com/u/${author.id}?s=40`
        : `https://github.com/${author.login}.png?size=40`;
}

/** Whether the commit was written by the signed-in GitHub account (same email, display name or login). */
export function isProfileAuthor(
    commit: GitCommit,
    profile: GithubProfile,
): boolean {
    const email = commit.authorEmail.trim().toLowerCase();
    const name = commit.authorName.trim().toLowerCase();

    return (
        (profile.email !== '' && email === profile.email.toLowerCase()) ||
        (profile.name !== '' && name === profile.name.toLowerCase()) ||
        name === profile.login.toLowerCase() ||
        parseGithubAuthor(email)?.login.toLowerCase() ===
            profile.login.toLowerCase()
    );
}

/** The author's GitHub picture (`ownAvatar` for the signed-in account), or the first letter of the name when there is none or it fails to load. */
function CommitAvatar({
    name,
    email,
    ownAvatar,
}: {
    name: string;
    email: string;
    ownAvatar: string;
}) {
    const url = ownAvatar !== '' ? ownAvatar : getGithubAvatarUrl(email);
    const [failed, setFailed] = useState(false);

    if (url !== null && !failed) {
        return (
            <img
                src={url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
                className="size-5 shrink-0 rounded-full bg-zinc-300 object-cover dark:bg-zinc-700"
            />
        );
    }

    return (
        <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-medium uppercase dark:bg-zinc-700"
        >
            {name.charAt(0) || <GitCommitHorizontal className="size-3" />}
        </span>
    );
}

/** One commit row. Memoized: scrolling or typing in the filter re-renders only the rows whose props changed. */
export const CommitRow = memo(function CommitRow({
    commit,
    ownAvatar,
    isOpen,
    onToggle,
}: {
    commit: GitCommit;
    ownAvatar: string;
    isOpen: boolean;
    onToggle: (hash: string) => void;
}) {
    return (
        <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => onToggle(commit.hash)}
            style={{ height: ROW_HEIGHT }}
            className={cn(
                'flex w-full items-center gap-2 px-2 text-left hover:bg-zinc-200/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:bg-zinc-800/60',
                isOpen && 'bg-zinc-200/60 dark:bg-zinc-800/60',
            )}
        >
            {isOpen ? (
                <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
                <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                />
            )}
            <CommitAvatar
                key={commit.authorEmail}
                name={commit.authorName}
                email={commit.authorEmail}
                ownAvatar={ownAvatar}
            />
            <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
            {commit.refs.map((ref) => (
                <span
                    key={`${ref.kind}:${ref.name}`}
                    className={cn(
                        'shrink-0 rounded px-1.5 py-px text-[10px] font-medium',
                        REF_STYLE[ref.kind],
                    )}
                >
                    {ref.name}
                </span>
            ))}
            <span
                title={commit.authorName}
                className="max-w-32 shrink-0 truncate text-muted-foreground"
            >
                {parseGithubAuthor(commit.authorEmail)?.login ??
                    commit.authorName}
            </span>
            <span className="w-24 shrink-0 text-right text-muted-foreground">
                {formatRelativeTime(commit.timestamp)}
            </span>
            <code className="w-14 shrink-0 text-muted-foreground">
                {commit.shortHash}
            </code>
        </button>
    );
});
