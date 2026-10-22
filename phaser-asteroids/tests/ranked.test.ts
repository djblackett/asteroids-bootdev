import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/core/player';
import {
  rankedRequested,
  RankedApiError,
  requestChallenge,
  resolveApiBase,
  submitRankedRun,
  type RankedChallenge,
} from '../src/ranked/api';
import { ControlTracker } from '../src/ranked/controls';
import { chosenNickname, localBest, readLocalScores, rememberScore, type StorageLike } from '../src/ranked/localScores';
import { rankedSession } from '../src/ranked/session';
import type { ReplayRecord } from '../src/replay';

const challenge: RankedChallenge = {
  runId: '11111111-1111-4111-8111-111111111111',
  token: 't'.repeat(43),
  seed: 123456,
  rulesVersion: '1.0.0',
  schemaVersion: 1,
  tickRate: 60,
  config: { playerCount: 1, livesMode: 'independent', friendlyFire: false, speed: [1, 1] },
  issuedAt: '2026-10-22T15:00:00.000Z',
  expiresAt: '2026-10-22T16:00:00.000Z',
};
const replay = { header: {}, inputs: [], totalTicks: 1 } as unknown as ReplayRecord;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const accepted = { status: 'accepted', replayed: false, score: { id: 's1', nickname: 'Ace', score: 1250, completedAt: '2026-10-22T15:01:00.000Z', durationSeconds: 25 }, ranks: { allTime: 3, weekly: 1 } };

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('resolveApiBase', () => {
  it('uses the build-time URL on a real host and ignores ?api= there', () => {
    expect(resolveApiBase('?api=https://evil.example', 'djblackett.github.io', 'https://lb.example.dev/')).toBe('https://lb.example.dev');
    expect(resolveApiBase('', 'djblackett.github.io', undefined)).toBeNull();
  });
  it('lets a loopback page point at a local backend, defaulting to wrangler dev', () => {
    expect(resolveApiBase('?api=http://127.0.0.1:8792/', '127.0.0.1')).toBe('http://127.0.0.1:8792');
    expect(resolveApiBase('', 'localhost')).toBe('http://127.0.0.1:8787');
  });
  it('rejects non-http(s) and malformed URLs', () => {
    expect(resolveApiBase('?api=javascript:alert(1)', '127.0.0.1', undefined)).toBe('http://127.0.0.1:8787');
    expect(resolveApiBase('', 'example.com', 'not a url')).toBeNull();
  });
  it('ranked play is only requested explicitly', () => {
    expect(rankedRequested('')).toBe(false);
    expect(rankedRequested('?debug=1')).toBe(false);
    expect(rankedRequested('?ranked=1')).toBe(true);
  });
});

describe('requestChallenge', () => {
  it('returns the server-issued challenge', async () => {
    const c = await requestChallenge('http://x', async () => reply(201, challenge));
    expect(c.seed).toBe(123456);
  });
  it('fails (never invents a challenge) when offline, rate limited, or refused', async () => {
    await expect(requestChallenge('http://x', async () => Promise.reject(new TypeError('offline')))).rejects.toMatchObject({ code: 'network' });
    await expect(requestChallenge('http://x', async () => reply(429, {}))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(requestChallenge('http://x', async () => reply(503, {}))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('refuses a challenge for different rules or an unsupported config', async () => {
    await expect(requestChallenge('http://x', async () => reply(201, { ...challenge, rulesVersion: '2.0.0' }))).rejects.toMatchObject({ code: 'update_required' });
    await expect(requestChallenge('http://x', async () => reply(201, { ...challenge, config: { ...challenge.config, playerCount: 2 } }))).rejects.toBeInstanceOf(RankedApiError);
    await expect(requestChallenge('http://x', async () => reply(201, { ...challenge, seed: -1 }))).rejects.toMatchObject({ code: 'bad_challenge' });
  });
});

describe('submitRankedRun', () => {
  const opts = { base: 'http://x', challenge, replay, controls: 'keyboard' as const, sleep: async () => undefined, retryDelaysMs: [1, 1, 1] };

  it('sends the token as a bearer credential, gzip-compressed, with the replay and reported controls (no score)', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const out = await submitRankedRun({ ...opts, nickname: 'Ace', fetchFn: async (url, init) => ((seen = { url, init: init! }), reply(200, accepted)) });
    expect(out.kind).toBe('accepted');
    expect(seen!.url).toBe(`http://x/api/v1/runs/${challenge.runId}/submit`);
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${challenge.token}`);
    expect(headers['Content-Encoding']).toBe('gzip');
    const bytes = seen!.init.body as Uint8Array;
    const text = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['controls', 'nickname', 'replay']);
    expect(body.controls).toEqual({ scheme: 'keyboard' });
  });

  it('retries network errors and "still verifying" with the same body, then succeeds', async () => {
    const bodies: unknown[] = [];
    let n = 0;
    const out = await submitRankedRun({
      ...opts,
      fetchFn: async (_u, init) => {
        bodies.push(init!.body);
        n++;
        if (n === 1) throw new TypeError('network down');
        if (n === 2) return reply(409, { error: { code: 'run_in_progress' } });
        if (n === 3) return reply(503, {});
        return reply(200, { ...accepted, replayed: true });
      },
    });
    expect(out).toMatchObject({ kind: 'accepted', replayed: true });
    expect(n).toBe(4);
    expect(new Set(bodies.map((b) => (b as Uint8Array).length)).size).toBe(1);
  });

  it('does not retry a definitive rejection', async () => {
    let n = 0;
    const out = await submitRankedRun({ ...opts, fetchFn: async () => (n++, reply(422, { error: { code: 'replay_rejected', reason: 'score_mismatch' } })) });
    expect(out).toMatchObject({ kind: 'rejected', reason: 'score_mismatch' });
    expect(n).toBe(1);
  });

  it('reports expiry and gives up after the retry budget when the service stays down', async () => {
    expect(await submitRankedRun({ ...opts, fetchFn: async () => reply(410, { error: { code: 'run_expired' } }) })).toMatchObject({ kind: 'failed' });
    let n = 0;
    const out = await submitRankedRun({ ...opts, fetchFn: async () => (n++, Promise.reject(new TypeError('offline'))) });
    expect(out.kind).toBe('failed');
    expect(n).toBe(4);
  });
});

describe('ControlTracker', () => {
  const idle = { ...NO_INPUT };
  const press = { ...NO_INPUT, shoot: true };
  it('reports the single source that actually drove the ship', () => {
    const t = new ControlTracker();
    t.observe({ keyboard: press, gamepad: idle, touch: null }, 'assisted');
    expect(t.scheme()).toBe('keyboard');
  });
  it('maps touch to the movement mode and ignores idle sources', () => {
    for (const [mode, scheme] of [['classic', 'touch-classic'], ['pointToFly', 'touch-point'], ['assisted', 'touch-assisted']] as const) {
      const t = new ControlTracker();
      t.observe({ keyboard: idle, gamepad: idle, touch: { ...NO_INPUT, steer: { heading: 90, mode: 'assist' } } }, mode);
      expect(t.scheme()).toBe(scheme);
    }
  });
  it('is mixed when several sources were used, unknown when none', () => {
    const t = new ControlTracker();
    expect(t.scheme()).toBe('unknown');
    t.observe({ keyboard: press, gamepad: idle, touch: null }, 'assisted');
    t.observe({ keyboard: idle, gamepad: { ...NO_INPUT, move: 1 }, touch: null }, 'assisted');
    expect(t.scheme()).toBe('mixed');
  });
});

describe('rankedSession', () => {
  it('hands a challenge to exactly one game and never reuses it', () => {
    rankedSession.setChallenge(challenge);
    expect(rankedSession.takeChallenge()?.runId).toBe(challenge.runId);
    expect(rankedSession.takeChallenge()).toBeNull();
  });
  it('ignores a late result for a run that is no longer current', () => {
    rankedSession.setChallenge(challenge);
    rankedSession.takeChallenge();
    rankedSession.beginRequest();
    rankedSession.finish(challenge.runId, { kind: 'accepted', score: accepted.score, ranks: accepted.ranks, replayed: false });
    expect(rankedSession.phase).toBe('requesting');
  });
  it('words the game-over line from the server answer only', () => {
    rankedSession.setChallenge(challenge);
    rankedSession.takeChallenge();
    rankedSession.set('submitting');
    expect(rankedSession.statusLine()).toContain('VERIFYING');
    rankedSession.finish(challenge.runId, { kind: 'accepted', score: accepted.score, ranks: accepted.ranks, replayed: false });
    expect(rankedSession.statusLine()).toBe('VERIFIED 1250  #1 THIS WEEK');
    rankedSession.beginRequest();
    expect(rankedSession.statusLine()).toBe('');
  });
});

describe('local score memory', () => {
  it('keeps this device\'s best scores and survives corrupt or blocked storage', () => {
    const s = memory();
    rememberScore({ id: 'a', score: 100, at: 'x' }, s);
    rememberScore({ id: 'b', score: 900, at: 'y' }, s);
    rememberScore({ id: 'a', score: 100, at: 'x' }, s);
    expect(readLocalScores(s).map((r) => r.id)).toEqual(['b', 'a']);
    expect(localBest(s)?.score).toBe(900);
    s.data.set('asteroids.rankedScores', '{not json');
    expect(readLocalScores(s)).toEqual([]);
    expect(() => rememberScore({ id: 'c', score: 1, at: 'z' }, { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
  it('remembers the chosen nickname', () => {
    const s = memory();
    expect(chosenNickname('?nick=Ace', s)).toBe('Ace');
    expect(chosenNickname('', s)).toBe('Ace');
  });
});
