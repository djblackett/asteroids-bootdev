import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from '../../src/replay/constants';
import { verifyReplay as liveVerifyReplay } from '../../src/replay/verifier';
import { ENGINES } from '../src/engines';
import { loadSettings } from '../src/config';
import { digest, guardProblems, readManifest, readReleased, releasedProblems, requiredVersions, RULES_DIR, supportProblems } from '../rules/policy.mjs';

// The release compatibility gate. It runs with the unit tests, which CI runs before it deploys the Worker, so a change that would strand
// an installed app, edit a frozen engine, or change gameplay without a rules version bump never reaches production. See ../rules/README.md.
vi.setConfig({ testTimeout: 120_000 });

interface Fixture {
  note: string;
  options: { maxTicks: number; requireGameOver: boolean; timeLimitTicks?: number };
  expected: unknown;
  replay: unknown;
}

const manifest = readManifest() as { versions: Record<string, { schemaVersion: number; files: Record<string, string> }> };
const released = readReleased();
const versions = Object.keys(manifest.versions);

const filesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name]));

const fixtures = (version: string): [string, Fixture][] =>
  Object.keys(manifest.versions[version]!.files)
    .filter((f) => f.startsWith('fixtures/'))
    .map((f) => [f, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RULES_DIR, version, f))).toString('utf8')) as Fixture]);

describe('the registry of supported rules versions', () => {
  it('engines.ts registers exactly the frozen versions in versions.json, each with its recorded schema', () => {
    expect(Object.keys(ENGINES).sort()).toEqual([...versions].sort());
    for (const v of versions) {
      expect(ENGINES[v]!.rulesVersion).toBe(v);
      expect(ENGINES[v]!.schemaVersion).toBe(manifest.versions[v]!.schemaVersion);
      expect(ENGINES[v]!.tickRate).toBe(60);
    }
  });

  it(`the current rules (${GAMEPLAY_RULES_VERSION}, schema ${REPLAY_SCHEMA_VERSION}) are frozen and registered: bump + \`npm run rules:freeze\` go together`, () => {
    expect(loadSettings().rulesVersion).toBe(GAMEPLAY_RULES_VERSION);
    expect(ENGINES[GAMEPLAY_RULES_VERSION], `rules ${GAMEPLAY_RULES_VERSION} is not frozen: run npm run rules:freeze and register it in server/src/engines.ts`).toBeDefined();
    expect(ENGINES[GAMEPLAY_RULES_VERSION]!.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
  });

  it('released.json is well formed, and every version a distributed Android build needs is still supported', () => {
    expect(releasedProblems(released)).toEqual([]);
    expect(supportProblems({ supported: Object.keys(ENGINES), current: GAMEPLAY_RULES_VERSION, released, today: new Date() })).toEqual([]);
  });
});

describe('frozen engines are never modified', () => {
  for (const v of versions) {
    it(`rules ${v}: every file matches the hash pinned in versions.json, and nothing is added or missing`, () => {
      const pinned = manifest.versions[v]!.files;
      expect(filesUnder(path.join(RULES_DIR, v)).sort()).toEqual(Object.keys(pinned).sort());
      for (const [file, hash] of Object.entries(pinned)) expect(digest(fs.readFileSync(path.join(RULES_DIR, v, file)), file), `${v}/${file}`).toBe(hash);
    });

    it(`rules ${v}: the engine is self-contained (imports nothing, so no live source can leak into it)`, () => {
      const src = fs.readFileSync(path.join(RULES_DIR, v, 'engine.mjs'), 'utf8');
      expect(src).not.toMatch(/^\s*import\s|\bimport\(|\brequire\(/m);
    });
  }
});

describe('reference replays', () => {
  for (const v of versions) {
    for (const [file, fixture] of fixtures(v)) {
      it(`rules ${v} ${file}: the frozen engine still computes the recorded result (${fixture.note})`, () => {
        expect(ENGINES[v]!.verifyReplay(fixture.replay, fixture.options)).toEqual(fixture.expected);
      });
    }
  }

  // The guard against an unversioned gameplay change: today's sources must reproduce the current version's reference games exactly.
  for (const [file, fixture] of fixtures(GAMEPLAY_RULES_VERSION)) {
    it(`the live sources reproduce rules ${GAMEPLAY_RULES_VERSION} ${file}`, () => {
      const live = liveVerifyReplay(fixture.replay, fixture.options);
      expect(
        live,
        `The simulation now gives a different result for a ${GAMEPLAY_RULES_VERSION} reference game. If gameplay changed on purpose, bump ` +
          'GAMEPLAY_RULES_VERSION in src/replay/constants.ts and run `npm run rules:freeze` (see server/rules/README.md). If it did not, it is a ' +
          'determinism bug: players on installed apps would be rejected.',
      ).toEqual(fixture.expected);
    });
  }

  it('the reference set covers both legitimate endings and two rejections', () => {
    const results = fixtures(GAMEPLAY_RULES_VERSION).map(([, f]) => f.expected as { valid: boolean; endReason?: string; discrepancy?: string });
    expect(results.some((r) => r.valid && r.endReason === 'game_over')).toBe(true);
    expect(results.some((r) => r.valid && r.endReason === 'time_limit')).toBe(true);
    expect(results.some((r) => !r.valid && r.discrepancy)).toBe(true);
    expect(results.some((r) => !r.valid && !r.discrepancy)).toBe(true);
  });
});

describe('compatibility policy', () => {
  const build = (b: Record<string, unknown>) => ({ platform: 'android', versionName: '1.0', versionCode: 1, rulesVersion: '1.2.0', schemaVersion: 1, distributed: '2026-11-10', supersededOn: null, ...b });
  const rel = (...builds: Record<string, unknown>[]) => ({ policy: { supportDays: 90 }, builds: builds.map(build) });
  const day = (d: string) => new Date(`${d}T12:00:00Z`);

  it('a version stays required until supportDays after its last build is superseded', () => {
    const r = rel({ versionCode: 1, rulesVersion: '1.2.0', supersededOn: '2027-01-01' }, { versionCode: 2, rulesVersion: '1.3.0' });
    expect(requiredVersions(r, day('2027-03-31'))).toEqual(['1.2.0', '1.3.0']);
    expect(requiredVersions(r, day('2027-04-01'))).toEqual(['1.3.0']);
    // Another build on the same rules keeps them required.
    const r2 = rel({ versionCode: 1, rulesVersion: '1.2.0', supersededOn: '2027-01-01' }, { versionCode: 2, rulesVersion: '1.2.0' });
    expect(requiredVersions(r2, day('2028-01-01'))).toEqual(['1.2.0']);
  });

  it('dropping a required version, or the current one, is reported', () => {
    const r = rel({ versionCode: 1, rulesVersion: '1.2.0' });
    expect(supportProblems({ supported: ['1.3.0'], current: '1.3.0', released: r, today: day('2027-01-01') })).toEqual([expect.stringContaining('rules 1.2.0 is still needed')]);
    expect(supportProblems({ supported: ['1.2.0'], current: '1.3.0', released: r, today: day('2027-01-01') })).toEqual([expect.stringContaining('current rules version 1.3.0')]);
    expect(releasedProblems({ policy: { supportDays: 0 }, builds: [build({ versionCode: 1 }), build({ versionCode: 1, rulesVersion: 'x' })] })).toHaveLength(3);
  });

  const frozen = { '1.2.0': { schemaVersion: 1, files: { 'engine.mjs': 'a' } } };
  const state = (versionsIn: object, releasedIn: object) => ({ manifest: { versions: versionsIn }, released: releasedIn });
  const today = day('2027-06-01');

  it('the CI guard: frozen files may be added but never modified, and deleted only once retired', () => {
    const r = rel({ versionCode: 1, rulesVersion: '1.2.0' });
    const same = state(frozen, r);
    expect(guardProblems({ changes: [{ status: 'A', path: '1.3.0/engine.mjs' }, { status: 'M', path: 'policy.mjs' }, { status: 'M', path: 'released.json' }], base: same, head: same, today })).toEqual([]);
    expect(guardProblems({ changes: [{ status: 'M', path: '1.2.0/engine.mjs' }], base: same, head: same, today })).toEqual([expect.stringContaining('frozen file modified')]);
    expect(guardProblems({ changes: [{ status: 'M', path: '1.2.0\\fixtures\\x.json.gz' }], base: same, head: same, today })).toHaveLength(1);
    // deleting a version that a distributed build still needs, even with the manifest entry removed too
    expect(guardProblems({ changes: [{ status: 'D', path: '1.2.0/engine.mjs' }], base: same, head: state({}, r), today }).length).toBeGreaterThan(0);
    // retiring after the support period: allowed
    const retired = rel({ versionCode: 1, rulesVersion: '1.2.0', supersededOn: '2027-01-01' }, { versionCode: 2, rulesVersion: '1.3.0' });
    expect(guardProblems({ changes: [{ status: 'D', path: '1.2.0/engine.mjs' }], base: state(frozen, retired), head: state({}, retired), today })).toEqual([]);
    // a manifest entry rewritten in place (e.g. to cover an edited engine)
    expect(guardProblems({ changes: [], base: same, head: state({ '1.2.0': { schemaVersion: 1, files: { 'engine.mjs': 'b' } } }, r), today })).toEqual([expect.stringContaining('changed')]);
  });

  it('the CI guard: release records are permanent and only gain their dates, without backdating', () => {
    const base = state(frozen, rel({ versionCode: 1, distributed: null }));
    const head = (b: Record<string, unknown>[]) => state(frozen, rel(...b));
    expect(guardProblems({ changes: [], base, head: head([{ versionCode: 1, distributed: '2027-05-30' }, { versionCode: 2, rulesVersion: '1.3.0' }]), today })).toEqual([]);
    expect(guardProblems({ changes: [], base, head: head([{ versionCode: 2 }]), today })).toEqual([expect.stringContaining('was removed')]);
    expect(guardProblems({ changes: [], base, head: head([{ versionCode: 1, distributed: null, rulesVersion: '1.3.0' }]), today })).toEqual([expect.stringContaining('rulesVersion changed')]);
    expect(guardProblems({ changes: [], base, head: head([{ versionCode: 1, distributed: null, supersededOn: '2027-06-01' }]), today })).toEqual([]);
    expect(guardProblems({ changes: [], base, head: head([{ versionCode: 1, distributed: null, supersededOn: '2026-01-01' }]), today })).toEqual([expect.stringContaining('no backdating')]);
    const set = state(frozen, rel({ versionCode: 1, supersededOn: '2027-06-01' }));
    expect(guardProblems({ changes: [], base: set, head: state(frozen, rel({ versionCode: 1, supersededOn: '2027-06-02' })), today })).toEqual([expect.stringContaining('supersededOn changed')]);
  });
});
