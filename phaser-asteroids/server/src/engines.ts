import type { VerificationResult } from '../../src/replay/types';
import type { VerifyOptions } from '../../src/replay/verifier';
import * as rules_1_2_0 from '../rules/1.2.0/engine.mjs';

/**
 * The gameplay rules versions this server can verify, as an explicit allowlist. Each entry is a FROZEN build of the replay engine
 * (simulation + verifier) for exactly one rules version and one replay schema, committed under ../rules/<version>/ and never edited
 * afterwards (see ../rules/README.md). The live game sources in ../../src are not used to verify anything: a gameplay change cannot
 * alter how runs of an existing version are scored, and a run keeps verifying under the version it was issued with for as long as
 * that version is listed here.
 *
 * To add a version: `npm run rules:freeze` (it writes ../rules/<version>/ and its manifest entry), then add one import and one
 * `frozen(...)` line below. To retire one: see the retirement policy in ../rules/README.md; tests refuse to drop a version that a
 * distributed Android build still needs (../rules/released.json).
 */
export const ENGINES: EngineRegistry = registry([frozen(rules_1_2_0)]);

export interface RulesEngine {
  readonly rulesVersion: string;
  /** The one replay schema this engine reads. A schema change always comes with a new rules version. */
  readonly schemaVersion: number;
  readonly tickRate: number;
  /** The contract every frozen engine keeps: `verifyReplay(replay, { maxTicks, requireGameOver, timeLimitTicks })`. */
  verifyReplay(replay: unknown, options: VerifyOptions): VerificationResult;
}

export type EngineRegistry = Readonly<Record<string, RulesEngine>>;

/** What a frozen bundle (`vite build --ssr src/replay/index.ts`) exports that the server relies on. */
export interface FrozenModule {
  GAMEPLAY_RULES_VERSION: string;
  REPLAY_SCHEMA_VERSION: number;
  FIXED_TICK_RATE: number;
  verifyReplay: (replay: unknown, options?: VerifyOptions) => VerificationResult;
}

/** Wraps a frozen bundle's module namespace (typed `unknown`: TypeScript's guesses about a plain JS file do not matter here). */
export function frozen(namespace: unknown): RulesEngine {
  const mod = namespace as FrozenModule;
  const { GAMEPLAY_RULES_VERSION: rulesVersion, REPLAY_SCHEMA_VERSION: schemaVersion, FIXED_TICK_RATE: tickRate } = mod;
  if (typeof rulesVersion !== 'string' || !Number.isInteger(schemaVersion) || !Number.isInteger(tickRate) || typeof mod.verifyReplay !== 'function') {
    throw new Error('not a replay engine bundle');
  }
  return Object.freeze({ rulesVersion, schemaVersion, tickRate, verifyReplay: (replay: unknown, options: VerifyOptions) => mod.verifyReplay(replay, options) });
}

export function registry(engines: readonly RulesEngine[]): EngineRegistry {
  const out: Record<string, RulesEngine> = Object.create(null);
  for (const e of engines) {
    if (out[e.rulesVersion]) throw new Error(`rules ${e.rulesVersion} registered twice`);
    out[e.rulesVersion] = e;
  }
  return Object.freeze(out);
}

/** The engine for an exact version string, or null. Untrusted input is fine: only the registry's own keys match. */
export function engineFor(engines: EngineRegistry, version: unknown): RulesEngine | null {
  return typeof version === 'string' && Object.prototype.hasOwnProperty.call(engines, version) ? engines[version]! : null;
}

/**
 * Which rules a new challenge is issued under. A client that names a supported rules version (and, if it names one, that version's
 * schema) gets exactly that, so an installed app keeps working after the server learns a newer version. Anything else, including no
 * request at all (web clients from before this existed), gets the server's current version, which is what every client got before;
 * a client running something else then sees the challenge does not match it and says "update". Never an error: the client decides.
 */
export function issueEngine(engines: EngineRegistry, currentVersion: string, requestedRules: string | null, requestedSchema: string | null): RulesEngine | null {
  const asked = engineFor(engines, requestedRules);
  if (asked && (requestedSchema === null || requestedSchema === String(asked.schemaVersion))) return asked;
  return engineFor(engines, currentVersion);
}
