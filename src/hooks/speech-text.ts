import { getLanguage, t } from '@/lib/i18n';

/** The answer as plain sentences to listen to: code blocks become a short remark, links a word, tables, markdown signs and decoration are left out. */
export function toSpokenText(markdown: string): string {
    return markdown
        .replace(/```[\s\S]*?```/g, ` ${t('composer.spoken_code')} `)
        .replace(/^\s*\|.*\|\s*$/gm, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\bhttps?:\/\/\S+/g, t('composer.spoken_link'))
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/^\s*([-=_*])\1{2,}\s*$/gm, ' ')
        .replace(/[*_~|#>•→←↔✓✗✔✘★☆]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const VIETNAMESE_MARKS =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const FALLBACK_LANGUAGES = { vi: 'vi-VN', en: 'en-US' } as const;

/** Language of a piece of text from its characters: Vietnamese marks, Kana, Hangul, Thai, Han, else Latin; null when there are too few letters to tell. */
export function detectLanguage(text: string): string | null {
    if (/[぀-ヿ]/.test(text)) {
        return 'ja-JP';
    }

    if (/[가-힯]/.test(text)) {
        return 'ko-KR';
    }

    if (/[฀-๿]/.test(text)) {
        return 'th-TH';
    }

    if (/[一-鿿]/.test(text)) {
        return 'zh-CN';
    }

    if (VIETNAMESE_MARKS.test(text)) {
        return 'vi-VN';
    }

    return (text.match(/[a-z]/gi) ?? []).length >= 3 ? 'en-US' : null;
}

/** The text cut into runs of one language, in order: sentences and lines are tagged, and neighbours of the same language are joined. A piece with too few letters joins the run before it (or the interface language when it comes first). */
export function splitByLanguage(
    text: string,
): { lang: string; text: string }[] {
    const fallback = FALLBACK_LANGUAGES[getLanguage()];
    const runs: { lang: string; text: string }[] = [];

    for (const piece of text.split(/(?<=[.!?。！？])\s+|\n+/)) {
        const trimmed = piece.trim();

        if (trimmed === '') {
            continue;
        }

        const lang = detectLanguage(trimmed) ?? runs.at(-1)?.lang ?? fallback;
        const last = runs.at(-1);

        if (last !== undefined && last.lang === lang) {
            last.text += ` ${trimmed}`;
        } else {
            runs.push({ lang, text: trimmed });
        }
    }

    return runs;
}

const sameLanguage = (voice: SpeechSynthesisVoice, lang: string) =>
    voice.lang.replace('_', '-').toLowerCase().split('-')[0] ===
    lang.toLowerCase().split('-')[0];

// * Old synthesized voices that sound like machines: never picked on their own.
const ROBOTIC_VOICE =
    /fred|zarvox|trinoids|bad news|bubbles|cellos|boing|whisper|bells|organ|good news|jester|albert|junior|ralph|kathy|superstar|deranged|hysterical|wobble/i;
const QUALITY_VOICE = /enhanced|premium|siri|natural/i;

/** How pleasant a voice is likely to be: natural-quality names, the northern Vietnamese "Linh", device voices; machine-like voices last. */
function voiceScore(voice: SpeechSynthesisVoice, lang: string): number {
    return (
        (QUALITY_VOICE.test(voice.name) ? 3 : 0) +
        (lang.startsWith('vi') && /linh/i.test(voice.name) ? 4 : 0) +
        (voice.localService ? 1 : 0) -
        (ROBOTIC_VOICE.test(voice.name) ? 5 : 0)
    );
}

/** The voice for `lang`: the one chosen in the settings when it speaks that language, else the most natural installed one (same region first, then by `voiceScore`); undefined lets the system choose from `utterance.lang`. */
export function chooseVoice(
    voices: SpeechSynthesisVoice[],
    lang: string,
    preferredName: string,
): SpeechSynthesisVoice | undefined {
    const preferred = voices.find((voice) => voice.name === preferredName);

    if (preferred !== undefined && sameLanguage(preferred, lang)) {
        return preferred;
    }

    const exact = (voice: SpeechSynthesisVoice) =>
        voice.lang.replace('_', '-').toLowerCase() === lang.toLowerCase();

    return voices
        .filter((voice) => sameLanguage(voice, lang))
        .sort(
            (a, b) =>
                Number(exact(b)) - Number(exact(a)) ||
                voiceScore(b, lang) - voiceScore(a, lang),
        )[0];
}

// * WebKit stops long utterances after a while: each piece is at most this long.
const MAX_PIECE_LENGTH = 200;

/** `text` cut at sentence ends and spaces into pieces of at most `MAX_PIECE_LENGTH` characters. */
export function splitIntoPieces(text: string): string[] {
    const pieces: string[] = [];
    let rest = text.trim();

    while (rest.length > MAX_PIECE_LENGTH) {
        const window = rest.slice(0, MAX_PIECE_LENGTH);
        const cut = Math.max(
            window.lastIndexOf('. '),
            window.lastIndexOf('! '),
            window.lastIndexOf('? '),
            window.lastIndexOf(', '),
            window.lastIndexOf(' '),
        );
        const end = cut > 0 ? cut + 1 : MAX_PIECE_LENGTH;

        pieces.push(rest.slice(0, end).trim());
        rest = rest.slice(end).trim();
    }

    if (rest !== '') {
        pieces.push(rest);
    }

    return pieces;
}
