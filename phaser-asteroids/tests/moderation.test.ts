import { describe, expect, it } from 'vitest';
import { BLOCKED_NAMES_KEY, NicknameBlocks, sendScoreReport } from '../src/ranked/moderation';

describe('nickname blocks and private reporting', () => {
  it('blocks all case variants locally, persists across sessions and can unblock', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const blocks = new NicknameBlocks(storage);
    blocks.toggle('Pilot');
    expect(new NicknameBlocks(storage).has('PILOT')).toBe(true);
    expect(data.has(BLOCKED_NAMES_KEY)).toBe(true);
    blocks.toggle('pilot');
    expect(blocks.has('Pilot')).toBe(false);
  });
  it('keeps session blocking usable with broken or disabled storage', () => {
    const blocks = new NicknameBlocks({ getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); } });
    blocks.toggle('Pilot');
    expect(blocks.has('pilot')).toBe(true);
    expect(new NicknameBlocks({ getItem: () => '{}', setItem: () => {} }).has('Pilot')).toBe(false);
  });
  it('sends only the selected entry and fixed reason, without credentials or free text', async () => {
    let request: { url: unknown; init?: RequestInit } | undefined;
    await sendScoreReport('https://api.test', 'score-id', 'personal_info', (async (url, init) => { request = { url, init }; return new Response('{}'); }) as typeof fetch);
    expect(request?.url).toBe('https://api.test/api/v1/scores/score-id/report');
    expect(request?.init?.body).toBe('{"reason":"personal_info"}');
    expect(request?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(request?.init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not show success when offline, unavailable or rate limited', async () => {
    await expect(sendScoreReport('https://api.test', 'id', 'other', (async () => new Response('', { status: 429 })) as typeof fetch)).rejects.toThrow('TOO MANY');
    await expect(sendScoreReport('https://api.test', 'id', 'other', (async () => new Response('', { status: 404 })) as typeof fetch)).rejects.toThrow('NOT SENT');
    await expect(sendScoreReport('https://api.test', 'id', 'other', (async () => { throw new Error('offline'); }) as typeof fetch)).rejects.toThrow();
  });
});
