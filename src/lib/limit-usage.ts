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
