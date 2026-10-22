export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const DEFAULT_NICKNAME = 'Anonymous';

export type NicknameResult = { ok: true; value: string } | { ok: false; message: string };

/** Letters and digits (any script), plus space and a few arcade-friendly marks. No `< > & " '`, so a nickname can never form markup. */
const ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N} _.!-]*$/u;

/**
 * Normalises and validates an optional arcade nickname: NFC, outer whitespace trimmed, inner whitespace runs collapsed to one
 * space, 3-16 characters (counted as Unicode code points), starting with a letter or digit. An absent nickname becomes
 * "Anonymous". The result is plain text: clients must still render it with textContent / escaping, never as HTML.
 */
export function sanitizeNickname(input: unknown): NicknameResult {
  if (input === undefined || input === null) return { ok: true, value: DEFAULT_NICKNAME };
  if (typeof input !== 'string') return { ok: false, message: 'nickname must be a string' };
  if (input.length > 256) return { ok: false, message: 'nickname is too long' };

  const value = input.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (value === '') return { ok: true, value: DEFAULT_NICKNAME };

  const length = [...value].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return { ok: false, message: `nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters` };
  }
  if (!ALLOWED.test(value)) {
    return { ok: false, message: 'nickname may contain letters, numbers, spaces and _ . ! - only, and must start with a letter or number' };
  }
  return { ok: true, value };
}
