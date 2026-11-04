import { sanitizeNickname as sanitizeCharacters, type NicknameResult } from '../../src/ranked/nickname';

// Deliberately small, whole-token denylist: never substring-match names such as
// Scunthorpe, Dickson, Fukuda or Assassin. This is a first-pass English content
// screen, not a claim to recognize every language, slur, threat or personal detail.
const DENIED = new Set(['fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot']);
export function sanitizeNickname(input: unknown): NicknameResult {
  const result = sanitizeCharacters(input);
  if (!result.ok) return result;
  const plain = result.value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
  const folded = plain.replace(/(?<=[a-z0-9])!(?=[a-z0-9])/g, 'i')
    .replace(/[013457@$]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' })[c]!);
  // Also catch an entire name spelled with separators, without scanning substrings.
  if ([plain, folded].some((variant) => {
    const tokens = variant.match(/[\p{L}\p{N}]+/gu) ?? [];
    return tokens.some((t) => DENIED.has(t)) || DENIED.has(tokens.join(''));
  })) {
    return { ok: false, message: 'Please choose a different nickname or leave it blank for Anonymous.' };
  }
  return result;
}
