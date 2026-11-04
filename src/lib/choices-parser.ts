export type ChoiceOption = {
    label: string;
    description?: string;
    recommended?: boolean;
};

export type Choices = {
    question: string;
    options: ChoiceOption[];
};

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;
export const MAX_QUESTION_LENGTH = 300;
export const MAX_LABEL_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number): value is string =>
    typeof value === 'string' && value.trim() !== '' && value.length <= max;

/**
 * Strictly parses the JSON of a ```choices block the AI may return. Anything off (bad JSON, wrong
 * types, 2 to 5 options, length caps) returns null so the caller shows a normal code block instead.
 */
export function parseChoices(source: string): Choices | null {
    let data: unknown;

    try {
        data = JSON.parse(source);
    } catch {
        return null;
    }

    if (
        !isRecord(data) ||
        !isText(data.question, MAX_QUESTION_LENGTH) ||
        !Array.isArray(data.options) ||
        data.options.length < MIN_OPTIONS ||
        data.options.length > MAX_OPTIONS
    ) {
        return null;
    }

    const options: ChoiceOption[] = [];

    for (const raw of data.options as unknown[]) {
        if (
            !isRecord(raw) ||
            !isText(raw.label, MAX_LABEL_LENGTH) ||
            (raw.description !== undefined &&
                !isText(raw.description, MAX_DESCRIPTION_LENGTH)) ||
            (raw.recommended !== undefined &&
                typeof raw.recommended !== 'boolean')
        ) {
            return null;
        }

        options.push({
            label: raw.label.trim(),
            ...(raw.description === undefined
                ? {}
                : { description: raw.description.trim() }),
            ...(raw.recommended === true ? { recommended: true } : {}),
        });
    }

    return { question: data.question.trim(), options };
}
