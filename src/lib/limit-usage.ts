import { t } from '@/lib/i18n';

const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

// * `/usage` prints "Nov 5 at 12:30am (Asia/Saigon)"; shown as "00:30 5/11", or as printed when the text is not in that shape.
export const formatReset = (resets: string): string => {
    const match = /^(\w{3}) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?(am|pm)/i.exec(
        resets,
    );
    const month = match === null ? -1 : MONTHS.indexOf(match[1]);

    if (match === null || month < 0) {
        return resets.replace(/\s*\(.*\)$/, '');
    }

    const hour = (Number(match[3]) % 12) + (/pm/i.test(match[5]) ? 12 : 0);
    const minute = match[4] ?? '00';

    return `${String(hour).padStart(2, '0')}:${minute} ${match[2]}/${month + 1}`;
};

const HALF_YEAR_MILLISECONDS = 183 * 24 * 60 * 60 * 1000;

// * Time left until a reset printed like "Nov 5 at 12:30am (Asia/Saigon)" (read as local time): "2 ngày 3g", "4g 30p", "45p"; null when it cannot be read.
export const formatRemaining = (
    resets: string,
    now: Date = new Date(),
): string | null => {
    const match = /^(\w{3}) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?(am|pm)/i.exec(
        resets,
    );
    const month = match === null ? -1 : MONTHS.indexOf(match[1]);

    if (match === null || month < 0) {
        return null;
    }

    const hour = (Number(match[3]) % 12) + (/pm/i.test(match[5]) ? 12 : 0);
    const minute = Number(match[4] ?? '0');
    const day = Number(match[2]);
    const build = (year: number): Date =>
        new Date(year, month, day, hour, minute);
    let target = build(now.getFullYear());

    if (target.getTime() <= now.getTime()) {
        if (now.getTime() - target.getTime() <= HALF_YEAR_MILLISECONDS) {
            return null;
        }

        target = build(now.getFullYear() + 1);
    }

    const totalMinutes = Math.ceil((target.getTime() - now.getTime()) / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];

    if (days > 0) {
        parts.push(`${days}${t('limit_usage.unit_day')}`);
    }

    if (hours > 0) {
        parts.push(`${hours}${t('limit_usage.unit_hour')}`);
    }

    if (minutes > 0 && days === 0) {
        parts.push(`${minutes}${t('limit_usage.unit_minute')}`);
    }

    return parts.length === 0
        ? `1${t('limit_usage.unit_minute')}`
        : parts.join(' ');
};

// * Tooltip text: the reset time, followed by the time left when it can be worked out.
export const formatResetTitle = (resets: string): string => {
    const remaining = formatRemaining(resets);
    const text = t('common.resets_time', { time: formatReset(resets) });

    return remaining === null
        ? text
        : `${text} · ${t('limit_usage.remaining', { duration: remaining })}`;
};

// * Green while there is room, yellow when the limit gets close, red when it is nearly used up.
export const limitColor = (percent: number): string =>
    percent >= 80
        ? 'bg-red-500'
        : percent >= 50
          ? 'bg-yellow-500'
          : 'bg-green-500';

export const LIMIT_LABELS: Record<string, string> = {
    'Current session': 'limit_usage.session',
    'Current week (all models)': 'limit_usage.week',
};

/** The limit's name as the user reads it: the CLI prints it in English ("Current week (Fable)"), so the known ones are translated. */
export const limitLabel = (label: string): string => {
    const key = LIMIT_LABELS[label];

    if (key !== undefined) {
        return t(key);
    }

    const model = /^Current week \((.+)\)$/.exec(label)?.[1];

    return model === undefined ? label : t('limit_usage.week_model', { model });
};
