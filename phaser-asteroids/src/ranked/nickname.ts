export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
/** Separate UTF-16 input budget, before normalization or grapheme segmentation. */
export const NICKNAME_INPUT_MAX = 256;
export const DEFAULT_NICKNAME = 'Anonymous';
export type NicknameResult = { ok: true; value: string } | { ok: false; message: string };

// Shared by the browser and Worker. Names are plain text, never HTML.
const ALLOWED = /^[\p{L}\p{N}\p{M}\p{Sc} #@&+%! ?_.’‘'\-]+$/u;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const ORPHAN_MARK = /(^|[^\p{L}\p{N}\p{M}])\p{M}/u;
const normalize = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ');

type SegmenterType = new (locale?: string, options?: { granularity: string }) => {
  segment(value: string): Iterable<unknown>;
};
const Segmenter = (Intl as unknown as { Segmenter?: SegmenterType }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;
/** Older runtimes fall back to base characters plus their combining marks. */
export function nicknameLength(value: string): number {
  return segmenter ? Array.from(segmenter.segment(value)).length : (value.match(/[^\p{M}]\p{M}*|^\p{M}+/gu) ?? []).length;
}

export function sanitizeNickname(input: unknown): NicknameResult {
  if (input === undefined || input === null) return { ok: true, value: DEFAULT_NICKNAME };
  if (typeof input !== 'string') return { ok: false, message: 'Please enter a name.' };
  if (input.length > NICKNAME_INPUT_MAX) return { ok: false, message: 'Name input is too large.' };
  // Check BEFORE whitespace collapsing: pasted line breaks/tabs must not disappear into valid spaces.
  if (UNSAFE.test(input)) return { ok: false, message: 'Please remove hidden characters or line breaks.' };
  const value = normalize(input);
  if (!value) return { ok: true, value: DEFAULT_NICKNAME };
  if (!ALLOWED.test(value) || !/[\p{L}\p{N}]/u.test(value) || ORPHAN_MARK.test(value)) {
    return { ok: false, message: 'Use letters, numbers and arcade symbols. No markup, please.' };
  }
  const length = nicknameLength(value);
  if (length < NICKNAME_MIN) return { ok: false, message: `Too short: at least ${NICKNAME_MIN} characters.` };
  if (length > NICKNAME_MAX) return { ok: false, message: `Too long: ${NICKNAME_MAX} characters at most.` };
  return { ok: true, value };
}

export const NICKNAME_HELP = '3-16 CHARACTERS. INTERNATIONAL NAMES & ARCADE SYMBOLS WELCOME. BLANK = ANONYMOUS.';
export function nicknameFeedback(raw: string): string | null {
  const result = sanitizeNickname(raw);
  return result.ok ? null : result.message.toUpperCase();
}
