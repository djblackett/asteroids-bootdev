import { describe, expect, it } from 'vitest';
import { sanitizeNickname, nicknameFeedback, nicknameLength } from '../src/ranked/nickname';
import { sanitizeNickname as workerValidator } from '../server/src/nickname';
import { addText } from '../src/ui/text';
import type Phaser from 'phaser';

describe('expressive shared nicknames', () => {
  it.each(['HolyMoo$3', "O'Connor", 'Renée', 'Søren', 'François', 'Łukasz', '李小龍', 'किरण', 'q\u0301bc', 'Ace#@&+%!?_.-', '£Ace€¥₹', 'O’Connor', '$Ace'])('accepts %s on client and Worker', (name) => {
    const expected = { ok: true, value: name.normalize('NFC') };
    expect(sanitizeNickname(name)).toEqual(expected);
    expect(workerValidator(name)).toEqual(expected);
    expect(nicknameFeedback(name)).toBeNull();
  });
  it('normalizes spaces and NFC and preserves the Anonymous fallback', () => {
    expect(sanitizeNickname('  Rene\u0301e\u00a0  Ace  ')).toEqual({ ok: true, value: 'Renée Ace' });
    for (const name of [undefined, null, '', '   ']) expect(sanitizeNickname(name)).toEqual({ ok: true, value: 'Anonymous' });
  });
  it('counts displayed graphemes and retains a separate input bound', () => {
    const cluster = 'q\u0301\u0323';
    expect(nicknameLength(cluster.repeat(16))).toBe(16);
    expect(sanitizeNickname(cluster.repeat(2)).ok).toBe(false);
    expect(sanitizeNickname(cluster.repeat(3)).ok).toBe(true);
    expect(sanitizeNickname(cluster.repeat(16)).ok).toBe(true);
    expect(sanitizeNickname(cluster.repeat(17)).ok).toBe(false);
    expect(sanitizeNickname('a' + '\u0301'.repeat(256)).ok).toBe(false);
    expect(sanitizeNickname('𐐀'.repeat(16)).ok).toBe(true);
  });
  it.each(['Ace\nX', 'Ace\rX', 'Ace\tX', 'Ace\u0000X', 'Ace\u007fX', 'Ace\u0085X', 'Ace\u2028X', 'Ace\u2029X', 'Ace\u200bX', 'Ace\u200dX', 'Ace\u202eX', 'Ace\u2066X', 'Ace\ufe0fX', '\u0301Ace', 'Ace \u0301', '!!!', '<b>Ace</b>', 'bad"quote', '`Ace`', 'Ace\\x', '\ud800Ace'])('rejects unsafe or unsupported input %j', (name) => {
    expect(sanitizeNickname(name).ok).toBe(false);
    expect(nicknameFeedback(name)).not.toBeNull();
  });
  it('passes literal names to the canvas text renderer, including HTML-like text from an untrusted response', () => {
    for (const content of ['李小龍 & O’Connor', '<img src=x onerror=alert(1)>', '&lt;script&gt;']) {
      let received = '';
      const text = { setOrigin: () => text };
      const scene = { add: { text: (_x: number, _y: number, value: string) => { received = value; return text; } } };
      addText(scene as unknown as Phaser.Scene, 0, 0, content, { size: 24 });
      expect(received).toBe(content); // Phaser Text paints glyphs; there is no DOM/HTML parsing sink.
    }
  });
});
