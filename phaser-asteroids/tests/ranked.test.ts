import { describe, expect, it, vi } from 'vitest';
import { NO_INPUT } from '../src/core/player';
import {
  classifySubmitResponse,
  fetchLeaderboard,
  fetchScoreDetail,
  localExpiry,
  prepareSubmission,
  rankedRequested,
  RankedApiError,
  requestChallenge,
  resolveApiBase,
  sendSubmission,
  type HttpRequest,
  type HttpResponse,
  type RankedChallenge,
  type Transport,
} from '../src/ranked/api';
import { ControlTracker } from '../src/ranked/controls';
import { forgetScore, lastNickname, localBest, readLocalScores, rememberNickname, rememberScore, startingNickname, type StorageLike } from '../src/ranked/localScores';
import { NICKNAME_HELP, nicknameFeedback, sanitizeNickname } from '../src/ranked/nickname';
import { refreshPersonalBest } from '../src/ranked/personalBest';
import { BOARD_PAGE_SIZE, formatScore, ScoresModel, weekLabel } from '../src/ranked/scoresModel';
import { rankedSession } from '../src/ranked/session';
import { SubmissionFlow } from '../src/ranked/submission';
import type { ReplayRecord } from '../src/replay';

const challenge: RankedChallenge = {
  runId: '11111111-1111-4111-8111-111111111111',
  token: 't'.repeat(43),
  seed: 123456,
  rulesVersion: '1.0.0',
  schemaVersion: 1,
  tickRate: 60,
  config: { playerCount: 1, livesMode: 'independent', friendlyFire: false, speed: [1, 1] },
  timeLimitTicks: 72_000,
  issuedAt: '2026-10-22T15:00:00.000Z',
  expiresAt: '2026-10-22T16:00:00.000Z',
};
const replay = { header: {}, inputs: [], totalTicks: 1 } as unknown as ReplayRecord;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const acceptedBody = {
  status: 'accepted',
  replayed: false,
  score: { id: 's1', nickname: 'Ace', score: 1250, completedAt: '2026-10-22T15:01:00.000Z', durationSeconds: 25, endReason: 'game_over' },
  ranks: { allTime: 3, weekly: 1 },
};
const ok = (body: unknown = acceptedBody): HttpResponse => ({ status: 200, body });
const err = (status: number, code: string, extra: Record<string, unknown> = {}): HttpResponse => ({ status, body: { error: { code, ...extra } } });

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** A transport that answers from a script and records every request it saw. */
function scripted(answers: Array<HttpResponse | Error | ((req: HttpRequest) => HttpResponse | Promise<HttpResponse>)>): Transport & { seen: HttpRequest[] } {
  const seen: HttpRequest[] = [];
  const t = (async (req: HttpRequest) => {
    seen.push(req);
    const next = answers[Math.min(seen.length - 1, answers.length - 1)]!;
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(req) : next;
  }) as Transport & { seen: HttpRequest[] };
  t.seen = seen;
  return t;
}
const noWait = { sleep: async () => undefined, retryDelaysMs: [1, 1] as const };

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
  it('the ?ranked shortcut is only a developer flag', () => {
    expect(rankedRequested('')).toBe(false);
    expect(rankedRequested('?debug=1')).toBe(false);
    expect(rankedRequested('?ranked=1')).toBe(true);
  });
});

describe('requestChallenge', () => {
  it('returns the server-issued challenge, time limit included', async () => {
    const c = await requestChallenge('http://x', async () => reply(201, challenge));
    expect(c.seed).toBe(123456);
    expect(c.timeLimitTicks).toBe(72_000);
  });
  it('fails (never invents a challenge) when offline, rate limited, or refused', async () => {
    await expect(requestChallenge('http://x', async () => Promise.reject(new TypeError('offline')))).rejects.toMatchObject({ code: 'network' });
    await expect(requestChallenge('http://x', async () => reply(429, {}))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(requestChallenge('http://x', async () => reply(503, {}))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('refuses a challenge for different rules, an unsupported config or an implausible limit', async () => {
    await expect(requestChallenge('http://x', async () => reply(201, { ...challenge, rulesVersion: '2.0.0' }))).rejects.toMatchObject({ code: 'update_required' });
    await expect(requestChallenge('http://x', async () => reply(201, { ...challenge, config: { ...challenge.config, playerCount: 2 } }))).rejects.toBeInstanceOf(RankedApiError);
    await expect(requestChallenge('http://x', async () => reply(201, { ...challenge, seed: -1 }))).rejects.toMatchObject({ code: 'bad_challenge' });
    for (const timeLimitTicks of [undefined, 0, 100, 72_001, 1.5, '72000']) {
      await expect(requestChallenge('http://x', async () => reply(201, { ...challenge, timeLimitTicks }))).rejects.toMatchObject({ code: 'bad_challenge' });
    }
  });
  it('expiry is judged on this device\'s clock, shifted by the clock difference at arrival', () => {
    // The phone's clock is 7 minutes fast: the server said "valid for 60 minutes" and that is what it gets.
    const arrival = Date.parse(challenge.issuedAt) + 7 * 60_000;
    expect(localExpiry(challenge, arrival) - arrival).toBe(60 * 60_000);
  });
});

describe('classifySubmitResponse', () => {
  it('only a 200 "accepted" is an acceptance', () => {
    expect(classifySubmitResponse(ok())).toMatchObject({ kind: 'accepted', replayed: false, ranks: { allTime: 3, weekly: 1 } });
    expect(classifySubmitResponse({ status: 200, body: { status: 'weird' } }).kind).toBe('refused');
    expect(classifySubmitResponse({ status: 200, body: { status: 'accepted', score: {}, ranks: {} } }).kind).toBe('transient');
  });
  it('maps every server answer to exactly one recoverability class', () => {
    expect(classifySubmitResponse(err(422, 'replay_rejected', { reason: 'score_mismatch' }))).toEqual({ kind: 'rejected', reason: 'score_mismatch' });
    expect(classifySubmitResponse(err(409, 'run_rejected', { reason: 'too_fast' })).kind).toBe('rejected');
    expect(classifySubmitResponse(err(410, 'run_expired')).kind).toBe('expired');
    expect(classifySubmitResponse(err(409, 'run_already_submitted')).kind).toBe('already_submitted');
    expect(classifySubmitResponse(err(400, 'invalid_nickname', { message: 'nickname must be 3-16 characters' }))).toMatchObject({ kind: 'invalid_nickname' });
    for (const r of [err(429, 'rate_limited'), err(503, 'service_unavailable'), err(409, 'run_in_progress'), err(409, 'run_busy'), { status: 502, body: null }]) {
      expect(classifySubmitResponse(r).kind).toBe('transient');
    }
    for (const r of [err(401, 'invalid_token'), err(413, 'payload_too_large'), err(415, 'unsupported_encoding'), err(404, 'run_not_found')]) {
      expect(classifySubmitResponse(r).kind).toBe('refused');
    }
  });
});

describe('prepareSubmission / sendSubmission', () => {
  const base = { base: 'http://x', challenge, replay, controls: 'keyboard' as const };

  it('is a gzip-compressed bearer request carrying the replay, the nickname and the reported controls, and no score', async () => {
    const p = await prepareSubmission({ ...base, nickname: 'Ace' });
    expect(p.url).toBe(`http://x/api/v1/runs/${challenge.runId}/submit`);
    expect(p.headers.Authorization).toBe(`Bearer ${challenge.token}`);
    expect(p.headers['Content-Encoding']).toBe('gzip');
    const text = await new Response(new Blob([p.body as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['controls', 'nickname', 'replay']);
    expect(body.nickname).toBe('Ace');
    expect(body.controls).toEqual({ scheme: 'keyboard' });
    expect(JSON.stringify(body)).not.toMatch(/"score"\s*:/);
  });

  it('repeats the IDENTICAL bytes after a transient failure, then returns the server\'s answer', async () => {
    const p = await prepareSubmission({ ...base, nickname: 'Ace' });
    const t = scripted([new Error('offline'), err(503, 'service_unavailable'), ok({ ...acceptedBody, replayed: true })]);
    const out = await sendSubmission(p, { transport: t, ...noWait });
    expect(out).toMatchObject({ kind: 'accepted', replayed: true });
    expect(t.seen).toHaveLength(3);
    expect(new Set(t.seen.map((r) => r.body)).size).toBe(1);
    expect(t.seen.every((r) => r.body === p.body)).toBe(true);
  });

  it('never repeats a definitive answer', async () => {
    const p = await prepareSubmission({ ...base });
    for (const answer of [err(422, 'replay_rejected', { reason: 'x' }), err(410, 'run_expired'), err(409, 'run_already_submitted'), err(401, 'invalid_token')]) {
      const t = scripted([answer]);
      await sendSubmission(p, { transport: t, ...noWait });
      expect(t.seen).toHaveLength(1);
    }
  });

  it('gives up after a bounded number of automatic repeats (no infinite loop)', async () => {
    const p = await prepareSubmission({ ...base });
    const t = scripted([new Error('offline')]);
    const out = await sendSubmission(p, { transport: t, ...noWait });
    expect(out.kind).toBe('transient');
    expect(t.seen).toHaveLength(3); // the first try + two automatic repeats
  });
});

describe('SubmissionFlow', () => {
  const make = (transport: Transport, extra: Partial<ConstructorParameters<typeof SubmissionFlow>[0]> = {}) => {
    const storage = memory();
    const flow = new SubmissionFlow({ base: 'http://x', challenge, replay, controls: 'touch-assisted', storage, send: { transport, ...noWait }, ...extra });
    return { flow, storage };
  };

  it('starts ready; invalid nicknames are caught before anything is sent', async () => {
    const t = scripted([ok()]);
    const { flow } = make(t);
    expect(flow.state).toEqual({ kind: 'ready', nicknameError: null });
    await flow.submit('ab');
    expect(flow.state).toMatchObject({ kind: 'ready', nicknameError: expect.stringContaining('TOO SHORT') });
    await flow.submit('<script>');
    expect(flow.state.kind).toBe('ready');
    expect(t.seen).toHaveLength(0);
  });

  it('goes uploading -> verifying (when the upload completes) -> accepted, and remembers the score and nickname only then', async () => {
    const states: string[] = [];
    let flowRef!: SubmissionFlow;
    const t = scripted([
      async (req) => {
        states.push(flowRef.state.kind); // while the request is out and the upload has not finished
        req.onUploaded?.();
        states.push(flowRef.state.kind);
        expect(readLocalScores(storage)).toEqual([]); // nothing is remembered before the server says so
        return ok();
      },
    ]);
    const made = make(t);
    flowRef = made.flow;
    const storage = made.storage;
    const done = made.flow.submit('  Ace  ');
    expect(made.flow.state.kind).toBe('uploading');
    await done;
    expect(states).toEqual(['uploading', 'verifying']);
    expect(made.flow.state).toMatchObject({ kind: 'accepted', score: { score: 1250 }, ranks: { weekly: 1 } });
    expect(readLocalScores(storage)).toEqual([{ id: 's1', score: 1250, at: '2026-10-22T15:01:00.000Z', nickname: 'Ace' }]);
    expect(lastNickname(storage)).toBe('Ace');
  });

  it('a lost response then Retry sends the very same request and cannot create a second score', async () => {
    const t = scripted([new Error('offline'), new Error('offline'), new Error('offline'), ok({ ...acceptedBody, replayed: true })]);
    const { flow, storage } = make(t);
    await flow.submit('Ace');
    expect(flow.state.kind).toBe('network_error');
    expect(flow.editable).toBe(false); // the name is locked: a changed name would be a different body
    expect(t.seen).toHaveLength(3);
    await flow.retry();
    expect(flow.state).toMatchObject({ kind: 'accepted', replayed: true });
    expect(new Set(t.seen.map((r) => r.body)).size).toBe(1);
    expect(readLocalScores(storage)).toHaveLength(1);
  });

  it('does not touch the network again on its own after a failure (the player decides)', async () => {
    const t = scripted([new Error('offline')]);
    const { flow } = make(t);
    await flow.submit('Ace');
    const calls = t.seen.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(t.seen).toHaveLength(calls);
  });

  it('ignores a second submit or retry while a request is in flight', async () => {
    let release!: (r: HttpResponse) => void;
    const t = scripted([() => new Promise<HttpResponse>((r) => (release = r))]);
    const { flow } = make(t);
    const first = flow.submit('Ace');
    await flow.submit('Ace');
    await flow.retry();
    await vi.waitFor(() => expect(t.seen).toHaveLength(1)); // the request goes out once the body is compressed
    await flow.submit('Ace');
    expect(t.seen).toHaveLength(1);
    release(ok());
    await first;
    expect(flow.state.kind).toBe('accepted');
    await flow.submit('Ace'); // already accepted: nothing more is sent
    expect(t.seen).toHaveLength(1);
  });

  it('a server rejection is final: nothing is remembered and nothing is resent', async () => {
    const t = scripted([err(422, 'replay_rejected', { reason: 'score_mismatch' })]);
    const { flow, storage } = make(t);
    await flow.submit('Ace');
    expect(flow.state).toEqual({ kind: 'rejected', reason: 'score_mismatch' });
    await flow.retry();
    expect(t.seen).toHaveLength(1);
    expect(readLocalScores(storage)).toEqual([]);
    expect(lastNickname(storage)).toBe('');
  });

  it('the server finding the nickname invalid reopens the field (the run is still open) and the next send is a new body', async () => {
    const t = scripted([err(400, 'invalid_nickname', { message: 'nickname may not do that' }), ok()]);
    const { flow } = make(t);
    await flow.submit('Ace');
    expect(flow.state).toMatchObject({ kind: 'ready', nicknameError: 'NICKNAME MAY NOT DO THAT' });
    expect(flow.editable).toBe(true);
    await flow.submit('Better Ace');
    expect(flow.state.kind).toBe('accepted');
    expect(flow.sentNickname).toBe('Better Ace');
  });

  it('expired, duplicate and refused answers are terminal and honest', async () => {
    for (const [answer, kind] of [[err(410, 'run_expired'), 'expired'], [err(409, 'run_already_submitted'), 'duplicate'], [err(413, 'payload_too_large'), 'refused']] as const) {
      const { flow } = make(scripted([answer]));
      await flow.submit('Ace');
      expect(flow.state.kind).toBe(kind);
      expect(flow.finished).toBe(true);
    }
  });

  it('knowing the challenge expired, it does not send at all; with no API configured it says so', async () => {
    const t = scripted([ok()]);
    expect(make(t, { expired: () => true }).flow.state.kind).toBe('expired');
    expect(make(t, { base: null }).flow.state.kind).toBe('unavailable');
    const late = make(t, { expired: (() => { let n = 0; return () => ++n > 1; })() });
    expect(late.flow.state.kind).toBe('ready');
    await late.flow.submit('Ace');
    expect(late.flow.state.kind).toBe('expired');
    expect(t.seen).toHaveLength(0);
  });

  it('skipping is allowed before sending and after a failed send, never while a request is out or after an answer', async () => {
    const a = make(scripted([ok()]));
    a.flow.skip();
    expect(a.flow.state.kind).toBe('skipped');
    await a.flow.submit('Ace');
    expect(a.flow.state.kind).toBe('skipped'); // a skipped run is not submitted later
    const b = make(scripted([new Error('x')]));
    await b.flow.submit('Ace');
    b.flow.skip();
    expect(b.flow.state.kind).toBe('skipped');
    const c = make(scripted([ok()]));
    await c.flow.submit('Ace');
    c.flow.skip();
    expect(c.flow.state.kind).toBe('accepted');
  });

  it('notifies listeners of every change', async () => {
    const { flow } = make(scripted([ok()]));
    const seen: string[] = [];
    flow.onChange(() => seen.push(flow.state.kind));
    await flow.submit('Ace');
    expect(seen).toEqual(['uploading', 'accepted']);
    expect(flow.version).toBe(2);
  });
});

describe('nickname rules (shared with the server)', () => {
  it('uses the server\'s own function, so the two cannot disagree', () => {
    for (const raw of ['', 'Ace', 'ab', 'a'.repeat(17), 'Ace<b>', '_Ace', 'Dave J', 'ÅSTRO 99', 'has  two   spaces']) {
      expect(nicknameFeedback(raw) === null).toBe(sanitizeNickname(raw).ok);
    }
  });
  it('gives arcade-style feedback and states the rule', () => {
    expect(nicknameFeedback('ab')).toMatch(/SHORT/);
    expect(nicknameFeedback('a'.repeat(17))).toMatch(/LONG/);
    expect(nicknameFeedback('Ace!?')).toMatch(/LETTERS/);
    expect(nicknameFeedback('')).toBeNull();
    expect(NICKNAME_HELP).toMatch(/3-16/);
  });
});

describe('rankedSession', () => {
  it('hands a challenge to exactly one game and never reuses it', () => {
    rankedSession.setChallenge(challenge);
    expect(rankedSession.takeChallenge()?.challenge.runId).toBe(challenge.runId);
    expect(rankedSession.takeChallenge()).toBeNull();
  });
  it('carries the local expiry with the challenge', () => {
    rankedSession.setChallenge(challenge, 1_000_000);
    expect(rankedSession.takeChallenge()?.expiresAtLocal).toBe(1_000_000 + 3_600_000);
  });
  it('mirrors the submission flow\'s progress and ignores a flow for a run that is no longer current', async () => {
    rankedSession.setChallenge(challenge);
    rankedSession.takeChallenge();
    const flow = new SubmissionFlow({ base: 'http://x', challenge, replay, controls: 'keyboard', storage: memory(), send: { transport: scripted([ok()]), ...noWait } });
    rankedSession.attach(challenge.runId, flow);
    expect(rankedSession.phase).toBe('finished');
    await flow.submit('Ace');
    expect(rankedSession.phase).toBe('accepted');
    expect(rankedSession.snapshot().verifiedScore).toBe(1250);
    rankedSession.beginRequest();
    expect(rankedSession.phase).toBe('requesting');
    expect(rankedSession.snapshot().verifiedScore).toBeNull();
    const stale = new SubmissionFlow({ base: 'http://x', challenge, replay, controls: 'keyboard', storage: memory() });
    rankedSession.attach('some-other-run', stale);
    expect(rankedSession.phase).toBe('requesting');
  });
});

describe('local score memory and personal best', () => {
  it('keeps this device\'s best server-confirmed scores and survives corrupt or blocked storage', () => {
    const s = memory();
    rememberScore({ id: 'a', score: 100, at: 'x', nickname: 'One' }, s);
    rememberScore({ id: 'b', score: 900, at: 'y', nickname: 'Two' }, s);
    rememberScore({ id: 'a', score: 100, at: 'x', nickname: 'One' }, s);
    expect(readLocalScores(s).map((r) => r.id)).toEqual(['b', 'a']);
    expect(localBest(s)).toMatchObject({ score: 900, nickname: 'Two' }); // best across nicknames
    forgetScore('b', s);
    expect(localBest(s)?.id).toBe('a');
    s.data.set('asteroids.rankedScores', '{not json');
    expect(readLocalScores(s)).toEqual([]);
    const blocked: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => rememberScore({ id: 'c', score: 1, at: 'z' }, blocked)).not.toThrow();
    expect(lastNickname(blocked)).toBe('');
  });
  it('remembers only the last SUBMITTED nickname; ?nick= is just a starting value and stores nothing', () => {
    const s = memory();
    expect(startingNickname('?nick=Dev', s)).toBe('Dev');
    expect(lastNickname(s)).toBe('');
    rememberNickname('Ace', s);
    expect(startingNickname('', s)).toBe('Ace');
    expect(startingNickname('?nick=Dev', s)).toBe('Dev');
  });
  it('refreshes the best from the server, and forgets scores the server no longer lists', async () => {
    const s = memory();
    rememberScore({ id: 'gone', score: 5000, at: 'x', nickname: 'Old' }, s);
    rememberScore({ id: 'kept', score: 800, at: 'y', nickname: 'Ace' }, s);
    const detail = { score: { id: 'kept', rank: 4, nickname: 'Ace', score: 800, completedAt: '', durationSeconds: 1 }, ranks: { allTime: 4, weekly: 2 } };
    const best = await refreshPersonalBest('http://x', s, async (_b, id) => (id === 'gone' ? null : detail));
    expect(best).toMatchObject({ best: { id: 'kept', score: 800 }, ranks: { allTime: 4, weekly: 2 } });
    expect(readLocalScores(s).map((r) => r.id)).toEqual(['kept']);
  });
  it('offline or unconfigured, shows the remembered figure and invents nothing', async () => {
    const s = memory();
    expect(await refreshPersonalBest('http://x', s, async () => null)).toBeNull();
    rememberScore({ id: 'a', score: 100, at: 'x' }, s);
    expect(await refreshPersonalBest('http://x', s, async () => Promise.reject(new Error('offline')))).toMatchObject({ best: { id: 'a' }, ranks: null });
    expect(await refreshPersonalBest(null, s)).toMatchObject({ best: { id: 'a' }, ranks: null });
  });
});

describe('leaderboard client and ScoresModel', () => {
  const entry = (rank: number) => ({ id: `id${rank}`, rank, nickname: `Pilot ${rank}`, score: 1000 - rank, completedAt: '2026-10-22T15:00:00.000Z', durationSeconds: 60, endReason: 'game_over' });
  const page = (over: Record<string, unknown> = {}) => ({ scope: 'weekly', rulesVersion: '1.0.0', limit: 10, offset: 0, total: 25, timeZone: 'America/Halifax', weekStart: '2026-10-19T03:00:00.000Z', weekEnd: '2026-10-26T03:00:00.000Z', entries: [1, 2, 3].map(entry), ...over });

  it('asks for one screen at a time and parses the answer', async () => {
    let url = '';
    const p = await fetchLeaderboard('http://x', 'weekly', { limit: 10, offset: 20 }, async (u) => ((url = u), reply(200, page({ offset: 20 }))));
    expect(url).toBe('http://x/api/v1/leaderboard/weekly?limit=10&offset=20');
    expect(p).toMatchObject({ total: 25, offset: 20, timeZone: 'America/Halifax' });
    expect(p.entries[0]).toMatchObject({ rank: 1, nickname: 'Pilot 1' });
  });
  it('errors are typed, never a half-parsed page', async () => {
    await expect(fetchLeaderboard('http://x', 'weekly', { limit: 10, offset: 0 }, async () => Promise.reject(new Error('x')))).rejects.toMatchObject({ code: 'network' });
    await expect(fetchLeaderboard('http://x', 'weekly', { limit: 10, offset: 0 }, async () => reply(500, {}))).rejects.toMatchObject({ code: 'unavailable' });
    await expect(fetchLeaderboard('http://x', 'weekly', { limit: 10, offset: 0 }, async () => reply(200, page({ entries: [{ id: 1 }] })))).rejects.toMatchObject({ code: 'bad_response' });
  });
  it('fetchScoreDetail: null for an unknown or hidden score', async () => {
    expect(await fetchScoreDetail('http://x', 'nope', async () => reply(404, { error: { code: 'score_not_found' } }))).toBeNull();
    const d = await fetchScoreDetail('http://x', 'id1', async () => reply(200, { score: { ...entry(1), rank: 1 }, ranks: { allTime: 1, weekly: null } }));
    expect(d?.ranks).toEqual({ allTime: 1, weekly: null });
  });

  it('loads, switches boards, pages, and drops answers for a screen the player already left', async () => {
    const calls: string[] = [];
    const slow: Array<() => void> = [];
    const fetcher = (async (_b: string, scope: string, paging: { offset: number }) => {
      calls.push(`${scope}:${paging.offset}`);
      if (scope === 'all-time') await new Promise<void>((r) => slow.push(r));
      return page({ scope, offset: paging.offset });
    }) as unknown as typeof fetchLeaderboard;
    const m = new ScoresModel('http://x', fetcher);
    expect(m.status).toBe('loading');
    await m.load();
    expect(m).toMatchObject({ status: 'ready', scope: 'weekly', pageNumber: 1, pageCount: 3, canPrev: false, canNext: true });
    await m.next();
    expect(m.offset).toBe(BOARD_PAGE_SIZE);
    await m.prev();
    expect(m.offset).toBe(0);
    const pending = m.setScope('all-time'); // slow
    const back = m.setScope('weekly'); // the player switched back before the first answer arrived
    await back;
    slow.forEach((release) => release());
    await pending;
    expect(m.scope).toBe('weekly');
    expect(m.page?.scope).toBe('weekly');
  });
  it('empty, error and unavailable are distinct, friendly states', async () => {
    const empty = new ScoresModel('http://x', async () => page({ entries: [], total: 0 }) as never);
    await empty.load();
    expect(empty.status).toBe('empty');
    const down = new ScoresModel('http://x', async () => Promise.reject(new RankedApiError('network', 'x')));
    await down.load();
    expect(down.status).toBe('error');
    const none = new ScoresModel(null);
    await none.load();
    expect(none.status).toBe('unavailable');
    expect(none.canNext || none.canPrev).toBe(false);
  });
  it('shows the week the SERVER reports, in the server\'s zone; and groups scores the same everywhere', () => {
    // Monday 2026-10-19 00:00 ADT .. Monday 2026-10-26 00:00 ADT: the last day shown is the 25th, not the 26th.
    expect(weekLabel({ timeZone: 'America/Halifax', weekStart: '2026-10-19T03:00:00.000Z', weekEnd: '2026-10-26T03:00:00.000Z' })).toBe('OCT 19 - OCT 25');
    expect(weekLabel({})).toBeNull();
    expect(formatScore(24850)).toBe('24,850');
    expect(formatScore(7)).toBe('7');
    expect(formatScore(1234567)).toBe('1,234,567');
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
